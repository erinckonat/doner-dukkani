import type { Game } from '../Game';
import { fmtMoney } from '../ui/Hud';
import { TR } from '../ui/strings.tr';

export type EventId = 'rush' | 'match' | 'vip' | 'inspection' | 'rain' | 'payday';

interface EventDef {
  id: EventId;
  secs: number;
  weight: number;
  /** Only picked when this holds (e.g. online orders need the office). */
  when?: (g: Game) => boolean;
}

const hasOnline = (g: Game) => g.shops.some((s) => s.ss.unlocked.includes('office'));
const hasTables = (g: Game) => g.shops.some((s) => s.tables.length > 0);

const EVENTS: EventDef[] = [
  { id: 'rush', secs: 60, weight: 3 },
  { id: 'vip', secs: 60, weight: 2 },
  { id: 'payday', secs: 30, weight: 2 },
  { id: 'inspection', secs: 45, weight: 2, when: hasTables },
  { id: 'match', secs: 60, weight: 2, when: hasOnline },
  { id: 'rain', secs: 75, weight: 2, when: hasOnline },
];

/** Seconds of play before the first event, then between one event's end and the next. */
const FIRST_AFTER: [number, number] = [45, 75];
const GAP: [number, number] = [90, 170];
const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);

export interface ActiveEvent { id: EventId; t: number; secs: number }

/**
 * Something happens on the street every couple of minutes: a lunch rush, a celebrity
 * at the counter, the council inspector, a rainy spell, payday. Session-only: nothing
 * here is saved, so a reload simply starts a fresh countdown.
 */
export class Events {
  cur: ActiveEvent | null = null;
  private wait = rand(FIRST_AFTER);
  /** The VIP is on their way or in the queue. */
  vipPending = false;

  constructor(private g: Game) {}

  /** Walk-in customers arrive this many times as often (interval divided by it). */
  get footfall() {
    switch (this.cur?.id) {
      case 'rush': return 2.2;
      case 'rain': return 0.6;
      default: return 1;
    }
  }

  /** Online orders come this many times as often, with this many extra couriers allowed. */
  get online() {
    switch (this.cur?.id) {
      case 'match': return { rate: 4, extra: 3 };
      case 'rain': return { rate: 2.5, extra: 2 };
      default: return { rate: 1, extra: 0 };
    }
  }

  /** Multiplies every sale. */
  get cashMul() { return this.cur?.id === 'payday' ? 2 : 1; }

  get raining() { return this.cur?.id === 'rain'; }

  get left() { return this.cur ? Math.max(0, this.cur.secs - this.cur.t) : 0; }

  update(dt: number, active: boolean) {
    if (this.cur) {
      this.cur.t += dt;
      if (this.cur.t >= this.cur.secs) this.end();
      return;
    }
    if (!active) return;
    this.wait -= dt;
    if (this.wait <= 0) this.start();
  }

  /** Starts a given event, or a random one that fits the player's street. */
  start(id?: EventId) {
    const pool = EVENTS.filter((e) => (id ? e.id === id : (!e.when || e.when(this.g)) && !(e.id === 'vip' && this.vipPending)));
    let r = Math.random() * pool.reduce((s, e) => s + e.weight, 0);
    const def = pool.find((e) => (r -= e.weight) <= 0) ?? pool[0];
    if (!def) return;
    this.cur = { id: def.id, t: 0, secs: def.secs };
    this.g.sfx.play('fanfare', 1, 0);
    if (def.id === 'vip') {
      // To the shop the player is in, so they can see them come in; the döner shop otherwise.
      const shop = this.g.shops.find((s) => s === this.g.area) ?? this.g.shops[0];
      shop.spawnVip();
      this.vipPending = true;
      this.g.hud.toast(TR.events.vip.arrived(TR.shopName[shop.id]));
      return;
    }
    this.g.hud.toast(TR.events[def.id].start);
  }

  private end() {
    const id = this.cur!.id;
    this.cur = null;
    this.wait = rand(GAP);
    if (id === 'inspection') this.inspect();
  }

  /** The inspector's verdict: every table clean earns a certificate bonus, mess costs a fine. */
  private inspect() {
    const dirty = this.g.shops.reduce((n, s) => n + s.tables.filter((t) => t.dirty).length, 0);
    const base = Math.max(5000, Math.round(this.g.incomePerSecond() * 45 / 500) * 500);
    if (!dirty) {
      this.g.addMoney(base);
      this.g.hud.toast(TR.events.inspection.pass(fmtMoney(base)));
      this.g.sfx.play('unlock', 1, 0);
      this.g.celebrateAtPlayer();
    } else {
      const fine = Math.min(this.g.data.money, Math.round((base * 0.25 * dirty) / 500) * 500);
      this.g.data.money -= fine;
      this.g.hud.toast(TR.events.inspection.fail(dirty, fmtMoney(fine)));
    }
  }

  /** Dirty tables right now, for the inspection banner. */
  dirtyTables() {
    return this.g.shops.reduce((n, s) => n + s.tables.filter((t) => t.dirty).length, 0);
  }

  vipServed(amount: number) {
    this.vipPending = false;
    if (this.cur?.id === 'vip') this.cur.t = this.cur.secs;
    this.g.hud.toast(TR.events.vip.served(fmtMoney(amount)));
    this.g.celebrateAtPlayer();
  }

  vipLeft() {
    this.vipPending = false;
    if (this.cur?.id === 'vip') this.cur.t = this.cur.secs;
    this.g.hud.toast(TR.events.vip.left);
  }
}
