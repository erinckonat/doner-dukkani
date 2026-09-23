import * as THREE from 'three';
import type { ProductKind, StaffRole } from '../config/balance';
import type { Shop } from '../Shop';
import type { Counter } from '../stations/Counter';
import type { Producer } from '../stations/Producer';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { C } from '../world/Assets';
import { Agent, dist2 } from './Agent';
import { LOOKS, pick } from './Character';

const SHIRT: Record<StaffRole, string> = { cashier: C.gold, carrier: C.gold, cleaner: '#5E8C7A' };

/** Hired worker. Carriers and cleaners run the same station interactions as the player. */
export class Staff extends Agent {
  stack: ItemStack;
  accepts: Set<ItemKind>;
  cd = 0;
  isPlayer = false;
  atPost = false;
  private mode: 'collect' | 'deliver' = 'collect';
  private think = 0;

  /** `from` is where they appear (the door for a fresh hire); `home` is where they wait when idle. */
  constructor(public role: StaffRole, public counter: Counter | null, private home: THREE.Vector3, private g: Shop, from?: THREE.Vector3) {
    super({ shirt: SHIRT[role], pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), hat: 'cap', hatColor: C.primary, apron: role === 'cleaner' ? C.cream : undefined });
    this.stack = new ItemStack(this.ch.hand, g.flyer, () => g.staffCap);
    this.accepts = new Set<ItemKind>(role === 'carrier' ? g.def.producers.map((p) => p.product) : role === 'cleaner' ? ['trash'] : []);
    this.pos.copy(from ?? home);
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

  private thinkCarrier() {
    const g = this.g;
    const st = this.stack;
    const onCounters = (kind: ProductKind) => g.counters.reduce((n, k) => n + (k.stocks.get(kind)?.count ?? 0), 0);
    // Machines with something to pick up that fits what is already in hand.
    const ready = g.producers.filter((p) => p.tray.count > 0 && (!st.kind || st.kind === p.product));
    if (this.mode === 'collect') {
      if (st.isFull || (st.count > 0 && !ready.length)) this.mode = 'deliver';
      else {
        if (ready.length) {
          // Fetch what the counters are shortest of; then the fuller tray; then the nearer one.
          const score = (p: Producer) => p.tray.count - 2 * onCounters(p.product) - Math.sqrt(dist2(p.zone, this.pos)) * 0.2;
          const best = ready.reduce((a, b) => (score(b) > score(a) ? b : a));
          this.moveTo(g.nav, best.zone);
        } else if (!st.count && !g.producers.some((p) => dist2(this.pos, p.zone) < 1)) {
          this.moveTo(g.nav, this.home);
        }
        return;
      }
    }
    if (!st.count) { this.mode = 'collect'; return; }
    const kind = st.kind as ProductKind;
    const open = g.counters.filter((k) => k.stocks.get(kind) && !k.stocks.get(kind)!.isFull);
    if (!open.length) return;
    const k = open.reduce((a, b) => (b.stocks.get(kind)!.count < a.stocks.get(kind)!.count ? b : a));
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
