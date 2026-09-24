import * as THREE from 'three';
import type { ProductKind, StaffRole } from '../config/balance';
import type { Shop } from '../Shop';
import type { Counter } from '../stations/Counter';
import type { Producer } from '../stations/Producer';
import type { Table } from '../stations/Table';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { C } from '../world/Assets';
import { STAFF_ENTRY } from '../world/layout';
import { Agent, dist2 } from './Agent';
import { LOOKS, pick } from './Character';

/** Items worth keeping ready on each counter when nobody is waiting for them. */
const SPARE_MAIN = 6;
const SPARE_EXTRA = 4;
/** At most this many workers wait at one machine for the same product. */
const PER_MACHINE = 2;

const SHIRT: Record<StaffRole, string> = { manager: '#8FA6BF', cashier: C.gold, carrier: C.gold, cleaner: '#5E8C7A', stocker: '#3E6B5A', receptionist: '#2E3A55', housekeeper: '#E9E4DA' };

type Task = { kind: 'fetch'; product: ProductKind } | { kind: 'clean'; table: Table } | null;

/**
 * Hired worker. Cashiers hold the register. Waiters and cleaners share one job
 * list and never stand around while there's work: whatever a counter is short of,
 * then dirty tables, then topping up the counters. They differ only in which of the
 * first two comes first.
 */
export class Staff extends Agent {
  stack: ItemStack;
  accepts: Set<ItemKind>;
  cd = 0;
  isPlayer = false;
  /** What this worker is out to pick up; nothing else gets grabbed on the way. */
  wants?: ItemKind | null;
  /** The counter this worker is carrying food to. */
  dropAt?: Counter | null;
  atPost = false;
  /** Fired: dropping everything and walking out. */
  leaving = false;
  gone = false;
  private task: Task = null;
  private delivering = false;
  private think = 0;

  /** `from` is where they appear (the door for a fresh hire); `home` is where they wait when idle. */
  constructor(public role: StaffRole, public counter: Counter | null, private home: THREE.Vector3, private g: Shop, from?: THREE.Vector3) {
    super(role === 'manager'
      ? { shirt: SHIRT.manager, pants: '#3A3F4A', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), tie: C.gold }
      : { shirt: SHIRT[role], pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), hat: 'cap', hatColor: C.primary, apron: role === 'cleaner' ? C.cream : undefined });
    this.stack = new ItemStack(this.ch.hand, g.flyer, () => g.staffCap);
    const products = g.def.producers.map((p) => p.product);
    this.accepts = new Set<ItemKind>(role === 'cashier' ? [] : [...products, 'trash']);
    this.pos.copy(from ?? home);
    if (role !== 'cashier') { this.wants = null; this.dropAt = null; }
    if (role === 'cashier' && counter) counter.staffCashier = this;
  }

  update(dt: number) {
    this.speed = this.g.staffSpeed;
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
    if (this.role === 'cashier') this.thinkCashier(dt);
    else if (this.role === 'manager') this.thinkManager(dt);
    else this.thinkWorker();
  }

  /** Let go: drop what's in hand, leave the post, walk out of the door. */
  dismiss() {
    this.leaving = true;
    this.atPost = false;
    this.wants = null;
    this.stack.clear();
    if (this.counter?.staffCashier === this) this.counter.staffCashier = null;
    for (const k of this.g.counters) if (k.cover === this) k.cover = null;
    this.goTo(this.g.nav, new THREE.Vector3(STAFF_ENTRY[0], 0, STAFF_ENTRY[1]));
  }

  private thinkCashier(dt: number) {
    const k = this.counter!;
    this.atPost = this.moveTo(this.g.nav, k.cashierZone);
    if (this.atPost) this.ch.face(k.def.dir[0], k.def.dir[1], dt * 20);
  }

  /**
   * The manager steps in at any register that has customers but nobody serving,
   * and otherwise pitches in like everyone else. (Hiring and firing is the shop's
   * `manage`, which runs while a manager is on the payroll.)
   */
  private thinkManager(dt: number) {
    const uncovered = this.stack.count ? undefined : this.g.counters.find((k) =>
      k.queue.length && !k.playerHere && !k.staffCashier?.atPost && (!k.cover || k.cover === this));
    for (const k of this.g.counters) if (k.cover === this && k !== uncovered) k.cover = null;
    if (uncovered) {
      uncovered.cover = this;
      this.wants = null;
      this.atPost = this.moveTo(this.g.nav, uncovered.cashierZone);
      if (this.atPost) this.ch.face(uncovered.def.dir[0], uncovered.def.dir[1], dt * 20);
      return;
    }
    this.atPost = false;
    this.thinkWorker();
  }

  // ---------- shared view of the shop ----------

  private get mates() {
    return this.g.staff.filter((s) => s !== this && !s.leaving && s.role !== 'cashier');
  }

  /** Items of `kind` already in other workers' hands or being fetched by them. */
  private incoming(kind: ProductKind) {
    const cap = this.g.staffCap;
    return this.mates.reduce((n, s) =>
      n + (s.stack.kind === kind ? s.stack.count : 0) + (!s.stack.count && s.wants === kind ? cap : 0), 0);
  }

  /** What the queue at `k` still needs of `kind` beyond what's on that counter. */
  private owedAt(kind: ProductKind, k: Counter) {
    return Math.max(0, this.g.queueDemand(kind, k) - this.g.counterStock(kind, k));
  }

  /** Owed across counters (each counter on its own), less what's on its way. */
  private owed(kind: ProductKind) {
    return this.g.counters.reduce((n, k) => n + this.owedAt(kind, k), 0) - this.incoming(kind);
  }

  /** Short of the spare pile on every counter. */
  private spareGap(kind: ProductKind) {
    const want = kind === this.g.def.main ? SPARE_MAIN : SPARE_EXTRA;
    return this.g.counters.reduce((n, k) => n + Math.max(0, want - this.g.counterStock(kind, k)), 0) - this.incoming(kind);
  }

  private machines(kind: ProductKind) { return this.g.producers.filter((p) => p.product === kind); }

  /** Don't crowd a machine: a couple of workers per machine is plenty. */
  private crowded(kind: ProductKind) {
    const waiting = this.mates.filter((s) => s.wants === kind && !s.stack.count).length;
    return waiting >= this.machines(kind).length * PER_MACHINE;
  }

  private dirtyTable(): Table | null {
    const claimed = new Set(this.mates.map((s) => (s.task?.kind === 'clean' ? s.task.table : null)));
    const dirty = this.g.tables.filter((t) => t.dirty && !claimed.has(t));
    if (!dirty.length) return null;
    return dirty.reduce((a, b) => (dist2(b.center, this.pos) < dist2(a.center, this.pos) ? b : a));
  }

  /** The product most worth fetching now, by `gap` (owed or spare shortfall). */
  private bestProduct(gap: (k: ProductKind) => number): ProductKind | null {
    const kinds = [...new Set(this.g.producers.map((p) => p.product))];
    let best: ProductKind | null = null;
    let bestGap = 0;
    for (const k of kinds) {
      const n = gap(k);
      if (n > bestGap && !this.crowded(k)) { best = k; bestGap = n; }
    }
    return best;
  }

  private pickTask(): Task {
    const table = this.dirtyTable();
    const owedProduct = this.bestProduct((k) => this.owed(k));
    const fetch = (product: ProductKind | null): Task => (product ? { kind: 'fetch', product } : null);
    const clean: Task = table ? { kind: 'clean', table } : null;
    const first = this.role === 'cleaner' ? clean ?? fetch(owedProduct) : fetch(owedProduct) ?? clean;
    return first ?? fetch(this.bestProduct((k) => this.spareGap(k)));
  }

  // ---------- the job loop ----------

  private thinkWorker() {
    const st = this.stack;
    if (st.kind === 'trash') return this.carryTrash();
    if (st.count) return this.carryProduct(st.kind as ProductKind);
    this.delivering = false;
    this.dropAt = null;
    this.task = this.pickTask();
    const t = this.task;
    if (!t) {
      this.wants = null;
      this.moveTo(this.g.nav, this.home);
      return;
    }
    if (t.kind === 'clean') {
      this.wants = 'trash';
      this.moveTo(this.g.nav, t.table.access);
      return;
    }
    this.wants = t.product;
    this.moveTo(this.g.nav, this.bestMachine(t.product).zone);
  }

  private bestMachine(kind: ProductKind): Producer {
    const score = (p: Producer) => p.tray.count - Math.sqrt(dist2(p.zone, this.pos)) * 0.05;
    return this.machines(kind).reduce((a, b) => (score(b) > score(a) ? b : a));
  }

  /** Holding food: keep loading while it's needed and the machine has some, then deliver. */
  private carryProduct(kind: ProductKind) {
    const st = this.stack;
    const need = Math.max(this.owed(kind), this.spareGap(kind));
    const trayEmpty = this.machines(kind).every((p) => !p.tray.count);
    if (!this.delivering && !st.isFull && st.count < need && !trayEmpty) {
      this.wants = kind;
      this.moveTo(this.g.nav, this.bestMachine(kind).zone);
      return;
    }
    this.delivering = true;
    this.wants = null;
    // Where the queue is shortest of it first, else the emptiest pile with room.
    const open = this.g.counters.filter((k) => k.stocks.get(kind) && !k.stocks.get(kind)!.isFull);
    if (!open.length) return;
    const k = open.reduce((a, b) => {
      const da = this.owedAt(kind, a);
      const db = this.owedAt(kind, b);
      return db > da || (db === da && this.g.counterStock(kind, b) < this.g.counterStock(kind, a)) ? b : a;
    });
    this.dropAt = k;
    this.moveTo(this.g.nav, k.dropZone);
  }

  /** Holding trash: clear more tables while there's room, then the bin. */
  private carryTrash() {
    const table = this.stack.isFull ? null : this.dirtyTable() ?? (this.task?.kind === 'clean' && this.task.table.dirty ? this.task.table : null);
    if (table) {
      this.task = { kind: 'clean', table };
      this.wants = 'trash';
      this.moveTo(this.g.nav, table.access);
      return;
    }
    this.task = null;
    this.wants = null;
    this.moveTo(this.g.nav, this.g.bin.zone);
  }
}
