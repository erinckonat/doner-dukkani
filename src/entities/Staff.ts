import * as THREE from 'three';
import type { ProductKind, StaffRole } from '../config/balance';
import type { Shop } from '../Shop';
import type { Counter } from '../stations/Counter';
import type { Producer } from '../stations/Producer';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { C } from '../world/Assets';
import { Agent, dist2 } from './Agent';
import { LOOKS, pick } from './Character';

/** Spare items a waiter keeps on the counter when nobody is waiting for them. */
const SPARE_MAIN = 4;
const SPARE_EXTRA = 2;

const SHIRT: Record<StaffRole, string> = { cashier: C.gold, carrier: C.gold, cleaner: '#5E8C7A' };

/** Hired worker. Carriers and cleaners run the same station interactions as the player. */
export class Staff extends Agent {
  stack: ItemStack;
  accepts: Set<ItemKind>;
  cd = 0;
  isPlayer = false;
  /** What this waiter is on the way to fetch (see thinkCarrier). */
  wants?: ItemKind | null;
  atPost = false;
  private mode: 'collect' | 'deliver' = 'collect';
  private think = 0;

  /** `from` is where they appear (the door for a fresh hire); `home` is where they wait when idle. */
  constructor(public role: StaffRole, public counter: Counter | null, private home: THREE.Vector3, private g: Shop, from?: THREE.Vector3) {
    super({ shirt: SHIRT[role], pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), hat: 'cap', hatColor: C.primary, apron: role === 'cleaner' ? C.cream : undefined });
    this.stack = new ItemStack(this.ch.hand, g.flyer, () => g.staffCap);
    this.accepts = new Set<ItemKind>(role === 'carrier' ? g.def.producers.map((p) => p.product) : role === 'cleaner' ? ['trash'] : []);
    this.pos.copy(from ?? home);
    if (role === 'carrier') this.wants = null;
    if (role === 'cashier' && counter) counter.staffCashier = this;
  }

  update(dt: number) {
    this.speed = this.g.staffSpeed;
    this.cd -= dt;
    this.step(dt);
    this.ch.carrying = this.stack.count > 0;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.25;
    if (this.role === 'cashier') this.thinkCashier(dt);
    else if (this.role === 'carrier') this.thinkCarrier();
    else this.thinkCleaner();
  }

  private thinkCashier(dt: number) {
    const k = this.counter!;
    this.atPost = this.moveTo(this.g.nav, k.cashierZone);
    if (this.atPost) this.ch.face(k.def.dir[0], k.def.dir[1], dt * 20);
  }

  /**
   * Waiters fetch what the queue is actually short of: what customers still need,
   * minus what's on the counters and what other waiters already carry or are
   * fetching. With nothing owed they keep a small spare pile of each product.
   */
  private thinkCarrier() {
    const g = this.g;
    const st = this.stack;
    const cap = g.staffCap;
    const others = g.staff.filter((s) => s !== this && s.role === 'carrier');
    const incoming = (k: ProductKind) => others.reduce((n, s) =>
      n + (s.stack.kind === k ? s.stack.count : 0) + (!s.stack.count && s.wants === k ? cap : 0), 0);
    const spare = (k: ProductKind) => (k === g.def.main ? SPARE_MAIN : SPARE_EXTRA);
    const deficit = (k: ProductKind) => {
      const owed = g.queueDemand(k) - g.counterStock(k) - incoming(k);
      return Math.max(owed, spare(k) - g.counterStock(k) - incoming(k));
    };
    const machines = (k: ProductKind) => g.producers.filter((p) => p.product === k);

    if (this.mode === 'collect') {
      let kind = st.kind as ProductKind | null;
      if (!kind) {
        // Owed items first (weighted well above spares), then whichever pile is shortest.
        const kinds = [...new Set(g.producers.map((p) => p.product))];
        const score = (k: ProductKind) => {
          const owed = g.queueDemand(k) - g.counterStock(k) - incoming(k);
          return owed > 0 ? 100 + owed : deficit(k);
        };
        const best = kinds.reduce<ProductKind | null>((a, k) => (score(k) > 0 && (!a || score(k) > score(a)) ? k : a), null);
        kind = best;
      }
      this.wants = kind;
      if (!kind) {
        this.moveTo(g.nav, this.home);
        return;
      }
      const ms = machines(kind);
      const trayCount = (p: Producer) => p.tray.count - Math.sqrt(dist2(p.zone, this.pos)) * 0.05;
      const at = ms.reduce((a, b) => (trayCount(b) > trayCount(a) ? b : a));
      const nothingLeft = ms.every((p) => !p.tray.count);
      if (st.isFull || (st.count > 0 && (st.count >= deficit(kind) || nothingLeft))) {
        this.mode = 'deliver';
      } else {
        this.moveTo(g.nav, at.zone);
        return;
      }
    }
    if (!st.count) { this.mode = 'collect'; return; }
    this.wants = null;
    const kind = st.kind as ProductKind;
    // The counter whose queue is shortest of this product, else the emptiest pile.
    const open = g.counters.filter((k) => k.stocks.get(kind) && !k.stocks.get(kind)!.isFull);
    if (!open.length) return;
    const need = (k: Counter) => g.queueDemand(kind, k) - g.counterStock(kind, k);
    const k = open.reduce((a, b) => (need(b) > need(a) || (need(b) === need(a) && g.counterStock(kind, b) < g.counterStock(kind, a)) ? b : a));
    this.moveTo(g.nav, k.dropZone);
  }

  private thinkCleaner() {
    const g = this.g;
    const dirty = g.tables.filter((t) => t.dirty);
    if (this.mode === 'collect') {
      if (this.stack.isFull || (this.stack.count > 0 && !dirty.length)) this.mode = 'deliver';
      else {
        if (dirty.length) {
          const t = dirty.reduce((a, b) => (dist2(b.center, this.pos) < dist2(a.center, this.pos) ? b : a));
          this.moveTo(g.nav, t.access);
        } else this.moveTo(g.nav, this.home);
        return;
      }
    }
    if (!this.stack.count) { this.mode = 'collect'; return; }
    this.moveTo(g.nav, g.bin.zone);
  }
}
