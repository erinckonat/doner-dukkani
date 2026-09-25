/**
 * The city stock exchange. City companies' prices wander (a mean-reverting walk
 * around a slowly drifting "fair value"); the player's own companies are priced off
 * what they actually earn. The player can float part of their companies (IPO) for
 * cash — after which that share of the company's income goes to the public — buy
 * shares back, and trade city companies.
 */

export type OwnId = 'doner' | 'burger' | 'market' | 'hotel' | 'mall';

export interface CompanyDef {
  id: string;
  code: string;
  /** City companies trade from the start; own ones appear once the business exists. */
  own?: OwnId;
  start: number;
  /** Per-tick volatility of the log price, and per-tick drift of fair value. */
  vol: number;
  drift: number;
  shares: number;
}

/** Own companies: 100,000 shares each, priced at value / shares. */
export const OWN_SHARES = 100_000;
/** Most of an own company that can be public: the player keeps control. */
export const MAX_FLOAT = 0.49;
/** Brokerage commission per trade, and the cost of an IPO (brokers, underwriting, fees). */
export const COMMISSION = 0.002;
export const IPO_FEE = 0.05;
export const TICK_SECONDS = 5;
const HISTORY = 72;
/** Ticks to replay for time away, at most (one hour). */
const MAX_CATCH_UP = 720;

export const COMPANIES: CompanyDef[] = [
  { id: 'doner', code: 'DONER', own: 'doner', start: 0, vol: 0.012, drift: 0, shares: OWN_SHARES },
  { id: 'burger', code: 'BRGR', own: 'burger', start: 0, vol: 0.014, drift: 0, shares: OWN_SHARES },
  { id: 'market', code: 'MRKT', own: 'market', start: 0, vol: 0.01, drift: 0, shares: OWN_SHARES },
  { id: 'hotel', code: 'LALE', own: 'hotel', start: 0, vol: 0.011, drift: 0, shares: OWN_SHARES },
  { id: 'mall', code: 'LPARK', own: 'mall', start: 0, vol: 0.012, drift: 0, shares: OWN_SHARES },
  { id: 'holding', code: 'ANDLH', start: 118.5, vol: 0.009, drift: 0.00012, shares: 10_000_000 },
  { id: 'energy', code: 'MRMRE', start: 56.3, vol: 0.016, drift: 0.00008, shares: 10_000_000 },
  { id: 'bank', code: 'SHRBN', start: 42.8, vol: 0.008, drift: 0.0001, shares: 10_000_000 },
  { id: 'pide', code: 'KRDNZ', start: 24.6, vol: 0.013, drift: 0.00006, shares: 2_000_000 },
  { id: 'gym', code: 'MRKZS', start: 18.2, vol: 0.017, drift: 0.00004, shares: 2_000_000 },
  { id: 'cafe', code: 'KOSEK', start: 12.4, vol: 0.012, drift: 0.00005, shares: 2_000_000 },
  { id: 'barber', code: 'USTAB', start: 9.8, vol: 0.011, drift: 0.00003, shares: 2_000_000 },
];

export interface ExchangeState {
  prices: Record<string, number>;
  /** Log fair value per city company (what its price reverts towards). */
  fair: Record<string, number>;
  hist: Record<string, number[]>;
  /** Player's shares in city companies, and what they paid on average. */
  hold: Record<string, number>;
  basis: Record<string, number>;
  /** Own companies: shares in public hands. */
  float: Partial<Record<OwnId, number>>;
  t: number;
}

const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export interface ExchangeHost {
  /** Own company's fair value in TL (what the business is worth), or null if it doesn't exist. */
  companyValue(id: OwnId): number | null;
  money: number;
  spend(tl: number): void;
  receive(tl: number): void;
}

export class Exchange {
  s: ExchangeState;
  private acc = 0;

  constructor(state: ExchangeState | undefined, private host: ExchangeHost) {
    this.s = state ?? { prices: {}, fair: {}, hist: {}, hold: {}, basis: {}, float: {}, t: Date.now() };
    for (const c of COMPANIES) {
      if (c.own) continue;
      this.s.prices[c.id] ??= c.start;
      this.s.fair[c.id] ??= Math.log(c.start);
      this.s.hist[c.id] ??= [c.start];
    }
    // Replay the market for the time the game was closed.
    const ticks = Math.min(MAX_CATCH_UP, Math.floor((Date.now() - this.s.t) / (TICK_SECONDS * 1000)));
    for (let i = 0; i < ticks; i++) this.tick();
    this.s.t = Date.now();
  }

  /** Companies on the board: every city company, plus own businesses that exist. */
  listed() {
    return COMPANIES.filter((c) => !c.own || this.host.companyValue(c.own) !== null);
  }

  price(id: string) {
    const c = COMPANIES.find((x) => x.id === id)!;
    if (c.own && !this.s.prices[id]) return this.ownFair(c.own);
    return this.s.prices[id] ?? c.start;
  }

  /** Price 12 ticks (a minute) ago, for the change figure. */
  change(id: string) {
    const h = this.s.hist[id] ?? [];
    const then = h[Math.max(0, h.length - 13)] ?? this.price(id);
    return then ? this.price(id) / then - 1 : 0;
  }

  history(id: string) { return this.s.hist[id] ?? []; }

  private ownFair(id: OwnId) {
    return Math.max(0.01, (this.host.companyValue(id) ?? 0) / OWN_SHARES);
  }

  /** Share of an own company's income the player keeps. */
  ownerShare(id: OwnId) { return 1 - (this.s.float[id] ?? 0) / OWN_SHARES; }
  isPublic(id: OwnId) { return (this.s.float[id] ?? 0) > 0; }

  private tick() {
    for (const c of COMPANIES) {
      let p: number;
      if (c.own) {
        if (this.host.companyValue(c.own) === null) continue;
        // Own companies trade around what they're worth once public; before that, at book.
        const fair = this.ownFair(c.own);
        const prev = this.s.prices[c.id] ?? fair;
        p = this.isPublic(c.own)
          ? Math.exp(Math.log(prev) + 0.15 * (Math.log(fair) - Math.log(prev)) + c.vol * gauss())
          : fair;
      } else {
        this.s.fair[c.id] += c.drift + c.vol * 0.3 * gauss();
        const lp = Math.log(this.s.prices[c.id]);
        p = Math.exp(lp + 0.05 * (this.s.fair[c.id] - lp) + c.vol * gauss());
      }
      this.s.prices[c.id] = Math.round(p * 100) / 100 || 0.01;
      const h = (this.s.hist[c.id] ??= []);
      h.push(this.s.prices[c.id]);
      if (h.length > HISTORY) h.shift();
    }
  }

  update(dt: number) {
    this.acc += dt;
    if (this.acc < TICK_SECONDS) return false;
    this.acc = 0;
    this.tick();
    this.s.t = Date.now();
    return true;
  }

  // ---------- trading city companies ----------

  buy(id: string, n: number) {
    const cost = this.price(id) * n * (1 + COMMISSION);
    if (n <= 0 || this.host.money < cost) return false;
    const held = this.s.hold[id] ?? 0;
    this.s.basis[id] = ((this.s.basis[id] ?? 0) * held + this.price(id) * n) / (held + n);
    this.s.hold[id] = held + n;
    this.host.spend(cost);
    return true;
  }

  sell(id: string, n: number) {
    const held = this.s.hold[id] ?? 0;
    n = Math.min(n, held);
    if (n <= 0) return false;
    this.s.hold[id] = held - n;
    if (!this.s.hold[id]) delete this.s.basis[id];
    this.host.receive(this.price(id) * n * (1 - COMMISSION));
    return true;
  }

  /** Value of the player's city-company shares at today's prices. */
  portfolioValue() {
    return Object.entries(this.s.hold).reduce((sum, [id, n]) => sum + this.price(id) * n, 0);
  }

  // ---------- own companies ----------

  /** Shares that can still be floated before the public would hold more than MAX_FLOAT. */
  floatable(id: OwnId) { return Math.floor(OWN_SHARES * MAX_FLOAT) - (this.s.float[id] ?? 0); }

  /** Proceeds of floating `share` (e.g. 0.1 = 10%) of the company now, after fees. */
  ipoProceeds(id: OwnId, share: number) {
    const n = Math.min(Math.round(OWN_SHARES * share), this.floatable(id));
    return { n, tl: n * this.price(id) * (1 - IPO_FEE) };
  }

  ipo(id: OwnId, share: number) {
    const { n, tl } = this.ipoProceeds(id, share);
    if (n <= 0) return 0;
    if (!this.isPublic(id)) this.s.prices[id] = this.price(id);
    this.s.float[id] = (this.s.float[id] ?? 0) + n;
    this.host.receive(tl);
    return tl;
  }

  buybackCost(id: OwnId, share: number) {
    const n = Math.min(Math.round(OWN_SHARES * share), this.s.float[id] ?? 0);
    return { n, tl: n * this.price(id) * (1 + COMMISSION) };
  }

  buyback(id: OwnId, share: number) {
    const { n, tl } = this.buybackCost(id, share);
    if (n <= 0 || this.host.money < tl) return 0;
    this.s.float[id] = (this.s.float[id] ?? 0) - n;
    if (!this.s.float[id]) delete this.s.float[id];
    this.host.spend(tl);
    return tl;
  }
}
