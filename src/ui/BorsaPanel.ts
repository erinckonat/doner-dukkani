import type { Game } from '../Game';
import { COMMISSION, COMPANIES, MAX_FLOAT, OWN_SHARES, type CompanyDef, type OwnId } from '../systems/Exchange';
import { fmtMoney } from './Hud';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Buy buttons spend a round sum; IPO and buyback move a tenth of the company at a time. */
const BUY_AMOUNTS = [10_000, 100_000, 1_000_000];
const STEP = 0.1;

const pct = (x: number) => (x * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
const price = (x: number) => `₺${x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (tl: number) => (tl >= 1e6 ? `₺${tl / 1e6} Mn` : `₺${tl / 1e3} B`);

/** Price line for the last few minutes, drawn as an inline SVG. */
function spark(hist: number[], up: boolean) {
  if (hist.length < 2) return '';
  const w = 96;
  const h = 32;
  const lo = Math.min(...hist);
  const hi = Math.max(...hist);
  const span = hi - lo || 1;
  const pts = hist.map((p, i) => `${((i / (hist.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" /></svg>`;
}

/** The stock exchange, opened at the bank's door. */
export class BorsaPanel {
  private wrap = $('borsa-panel');
  private list = $('borsa-list');
  private refreshT = 0;

  constructor(private g: Game) {
    $('borsa-close').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn) return;
      const id = btn.dataset.id!;
      const x = this.g.exchange;
      switch (btn.dataset.act) {
        case 'buy': {
          const n = Math.floor(Number(btn.dataset.amt) / (x.price(id) * (1 + COMMISSION)));
          if (x.buy(id, n)) {
            this.g.sfx.play('register', 1, 0);
            this.g.data.stats!.trades++;
          }
          break;
        }
        case 'sell': {
          const held = x.s.hold[id] ?? 0;
          if (x.sell(id, btn.dataset.half ? Math.ceil(held / 2) : held)) this.g.sfx.play('register', 1, 0);
          break;
        }
        case 'ipo': {
          const tl = x.ipo(id as OwnId, STEP);
          if (tl) {
            this.g.sfx.play('unlock', 1, 0);
            this.g.hud.toast(TR.borsa.ipoDone(TR.borsa.company[id], fmtMoney(tl)));
          }
          break;
        }
        case 'buyback': {
          const tl = x.buyback(id as OwnId, STEP);
          if (tl) {
            this.g.sfx.play('register', 1, 0);
            this.g.hud.toast(TR.borsa.buybackDone(TR.borsa.company[id], fmtMoney(tl)));
          }
          break;
        }
      }
      this.g.save();
      this.render();
    });
  }

  get isOpen() { return !this.wrap.hidden; }

  open() {
    this.render();
    this.wrap.hidden = false;
  }

  close() { this.wrap.hidden = true; }

  update(dt: number, ticked: boolean) {
    if (!this.isOpen) return;
    this.refreshT -= dt;
    if (this.refreshT > 0 && !ticked) return;
    this.refreshT = 0.5;
    this.render();
  }

  private head(c: CompanyDef) {
    const x = this.g.exchange;
    const ch = x.change(c.id);
    const up = ch >= 0;
    return `<div class="stock-head">
      <div class="upg-info">
        <h3>${TR.borsa.company[c.id]} <span class="ticker">${c.code}</span></h3>
        <p class="quote"><b>${price(x.price(c.id))}</b> <span class="${up ? 'up' : 'down'}">${up ? '+' : ''}${pct(ch)}%</span></p>
      </div>
      ${spark(x.history(c.id), up)}
    </div>`;
  }

  private ownRow(c: CompanyDef) {
    const x = this.g.exchange;
    const id = c.own!;
    const floated = (x.s.float[id] ?? 0) / OWN_SHARES;
    const ipo = x.ipoProceeds(id, STEP);
    const back = x.buybackCost(id, STEP);
    const value = x.price(c.id) * OWN_SHARES;
    return `<li class="upg stock">
      ${this.head(c)}
      <p class="note">${TR.borsa.value(fmtMoney(value))} · ${TR.borsa.owned(pct(1 - floated))}</p>
      <p class="note">${floated ? TR.borsa.publicPart(pct(floated)) : TR.borsa.notPublic}</p>
      <div class="stock-actions">
        <button class="buy mini" data-act="ipo" data-id="${id}" ${ipo.n <= 0 ? 'disabled' : ''}>${TR.borsa.ipo(STEP * 100)}<small>+${fmtMoney(ipo.tl)}</small></button>
        <button class="buy mini secondary" data-act="buyback" data-id="${id}" ${back.n <= 0 || this.g.money < back.tl ? 'disabled' : ''}>${TR.borsa.buyback(STEP * 100)}<small>${back.n ? fmtMoney(back.tl) : '—'}</small></button>
      </div>
    </li>`;
  }

  private cityRow(c: CompanyDef) {
    const x = this.g.exchange;
    const held = x.s.hold[c.id] ?? 0;
    const p = x.price(c.id);
    const pl = held ? (p - (x.s.basis[c.id] ?? p)) * held : 0;
    const plText = `${pl >= 0 ? '+' : '−'}${fmtMoney(Math.abs(Math.round(pl)))}`;
    const buys = BUY_AMOUNTS.map((amt) =>
      `<button class="buy mini" data-act="buy" data-id="${c.id}" data-amt="${amt}" ${this.g.money < amt ? 'disabled' : ''}>${TR.borsa.buy(short(amt))}</button>`).join('');
    return `<li class="upg stock">
      ${this.head(c)}
      <p class="note">${held ? `${TR.borsa.holding(held.toLocaleString('tr-TR'), fmtMoney(Math.round(held * p)))} <span class="${pl >= 0 ? 'up' : 'down'}">${plText}</span>` : TR.borsa.noHolding}</p>
      <div class="stock-actions">
        ${buys}
        <button class="buy mini secondary" data-act="sell" data-id="${c.id}" data-half="1" ${held < 2 ? 'disabled' : ''}>${TR.borsa.sellHalf}</button>
        <button class="buy mini secondary" data-act="sell" data-id="${c.id}" ${held ? '' : 'disabled'}>${TR.borsa.sellAll}</button>
      </div>
    </li>`;
  }

  private render() {
    const x = this.g.exchange;
    const listed = x.listed();
    const own = listed.filter((c) => c.own);
    const city = COMPANIES.filter((c) => !c.own);
    $('borsa-cash').textContent = fmtMoney(Math.floor(this.g.money));
    $('borsa-portfolio').textContent = fmtMoney(Math.round(x.portfolioValue()));
    const html = `<li class="upg section">${TR.borsa.own}</li>
      ${own.map((c) => this.ownRow(c)).join('')}
      <li class="fine">${TR.borsa.maxFloat.replace('49', String(Math.round(MAX_FLOAT * 100)))} ${TR.borsa.fees}</li>
      <li class="upg section">${TR.borsa.market}</li>
      ${city.map((c) => this.cityRow(c)).join('')}`;
    if (html === this.list.innerHTML) return;
    const focused = document.activeElement as HTMLElement | null;
    const key = focused?.dataset?.act ? `[data-act="${focused.dataset.act}"][data-id="${focused.dataset.id}"]${focused.dataset.amt ? `[data-amt="${focused.dataset.amt}"]` : ''}${focused.dataset.half ? '[data-half]' : ':not([data-half])'}` : null;
    const scroll = this.list.parentElement!.scrollTop;
    this.list.innerHTML = html;
    this.list.parentElement!.scrollTop = scroll;
    if (key) this.list.querySelector<HTMLButtonElement>(`button${key}`)?.focus();
  }
}
