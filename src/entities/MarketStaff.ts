import * as THREE from 'three';
import { GROCERIES, type GroceryKind } from '../config/market';
import type { Checkout, Market, Segment } from '../Market';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { C } from '../world/Assets';
import { Agent, dist2 } from './Agent';
import { LOOKS, pick } from './Character';

/**
 * Market staff. Cashiers hold a checkout. Stockers keep the shelves full: they
 * fill a trolley-load from the stockroom pallet the emptiest shelf needs and
 * put it out, one shelf at a time. The manager stands in at any checkout with
 * a queue and nobody at the till, and otherwise stocks shelves too.
 */
export class MarketStaff extends Agent {
  stack: ItemStack;
  accepts = new Set<ItemKind>(Object.keys(GROCERIES) as GroceryKind[]);
  cd = 0;
  isPlayer = false;
  wants: ItemKind | null = null;
  /** The shelf this stocker is taking the load to. */
  dropAt: Segment | null = null;
  atPost = false;
  leaving = false;
  gone = false;
  private think = 0;
  /** How many the shelf needed when the trip started: stop loading there. */
  private need = 0;

  constructor(public role: 'cashier' | 'stocker' | 'manager', public checkout: Checkout | null, private home: THREE.Vector3, private m: Market, from?: THREE.Vector3) {
    super(role === 'manager'
      ? { shirt: '#8FA6BF', pants: '#3A3F4A', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), tie: C.gold }
      : role === 'cashier'
        ? { shirt: '#2F5D8C', pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), apron: C.cream }
        : { shirt: '#3E6B5A', pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), hat: 'cap', hatColor: '#2F5D8C' });
    this.stack = new ItemStack(this.ch.hand, m.flyer, () => m.stockerCap);
    this.pos.copy(from ?? home);
    if (checkout) checkout.staffCashier = this;
  }

  update(dt: number) {
    this.speed = this.m.staffSpeed;
    this.cd -= dt;
    this.step(dt);
    this.ch.carrying = this.stack.count > 0;
    if (this.leaving) {
      if (this.arrived) this.gone = true;
      return;
    }
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.25;
    if (this.role === 'cashier') {
      const k = this.checkout!;
      this.atPost = this.moveTo(this.m.nav, k.cashierZone);
      if (this.atPost) this.ch.face(-1, 0, 1);
      return;
    }
    if (this.role === 'manager' && this.cover()) return;
    this.atPost = false;
    this.thinkStocker();
  }

  dismiss(exit: THREE.Vector3) {
    this.leaving = true;
    this.atPost = false;
    this.wants = null;
    this.stack.clear();
    if (this.checkout?.staffCashier === this) this.checkout.staffCashier = null;
    for (const k of this.m.checkouts) if (k.cover === this) k.cover = null;
    this.goTo(this.m.nav, exit);
  }

  /** Manager: take any till with a queue and nobody serving. True while covering one. */
  private cover() {
    const k = this.stack.count ? undefined : this.m.checkouts.find((c) =>
      c.queue.length && !c.playerHere && !c.staffCashier?.atPost && (!c.cover || c.cover === this));
    for (const c of this.m.checkouts) if (c.cover === this && c !== k) c.cover = null;
    if (!k) return false;
    k.cover = this;
    this.wants = null;
    this.atPost = this.moveTo(this.m.nav, k.cashierZone);
    if (this.atPost) this.ch.face(-1, 0, 1);
    return true;
  }

  private get mates() {
    return this.m.staff.filter((s) => s !== this && s.role !== 'cashier' && !s.leaving);
  }

  /** Room left on a shelf once what other stockers are bringing arrives. */
  private room(seg: Segment) {
    const coming = this.mates.reduce((n, s) => n + (s.dropAt === seg ? Math.max(s.stack.count, s.need) : 0), 0);
    return seg.cap - seg.stack.count - coming;
  }

  private thinkStocker() {
    const st = this.stack;
    const kind = st.kind as GroceryKind | null;
    const pallet = kind ? this.m.pallets.get(kind)! : null;
    // Loading at the pallet: keep going until the trolley is full or the shelf's need is met.
    if (kind && this.wants === kind && pallet && pallet.stack.count && st.count < this.need && !st.isFull) {
      this.moveTo(this.m.nav, pallet.zone);
      return;
    }
    if (st.count) {
      this.wants = null;
      if (!this.dropAt || this.dropAt.kind !== kind || this.dropAt.stack.isFull) {
        const open = this.m.segments.filter((s) => s.kind === kind && !s.stack.isFull);
        this.dropAt = open.length ? open.reduce((a, b) => (b.stack.count < a.stack.count ? b : a)) : null;
      }
      if (this.dropAt) this.moveTo(this.m.nav, this.dropAt.pick);
      else this.moveTo(this.m.nav, this.home);
      return;
    }
    // Empty-handed: the shelf with the most room that the stockroom can fill.
    this.dropAt = null;
    // Not worth a trip for one or two: wait until a shelf has room for a few.
    let best: Segment | null = null;
    let bestRoom = 4;
    for (const seg of this.m.segments) {
      const r = this.room(seg);
      if (r >= bestRoom && this.m.pallets.get(seg.kind)!.stack.count) {
        best = seg;
        bestRoom = r;
      }
    }
    if (!best) {
      this.wants = null;
      this.need = 0;
      this.moveTo(this.m.nav, this.home);
      return;
    }
    this.dropAt = best;
    this.need = bestRoom;
    this.wants = best.kind;
    const p = this.m.pallets.get(best.kind)!;
    if (dist2(this.pos, p.zone) > 0.03) this.moveTo(this.m.nav, p.zone);
  }
}
