import * as THREE from 'three';
import {
  BAL, hireCost, hireMax, MACHINE_PRICE, PRODUCTS, priceOf, SHOPS, UPGRADES, upgradeCost,
  type HireDef, type HireId, type ProductKind, type ShopDef, type ShopId, type UnlockDef, type UpgradeId,
} from './config/balance';
import { buffAmount } from './config/city';
import { Nav, type Rect } from './core/Nav';
import { writeSave, type SaveData, type ShopState } from './core/Save';
import { easeOutQuart } from './core/Tween';
import { dist2 } from './entities/Agent';
import { Car } from './entities/Car';
import { Courier } from './entities/Courier';
import { Customer } from './entities/Customer';
import { Staff } from './entities/Staff';
import type { Game } from './Game';
import { Counter, MAIN_COUNTER, WINDOW_COUNTER, type QueueMember } from './stations/Counter';
import { MenuStation } from './stations/MenuStation';
import { Producer } from './stations/Producer';
import { Desk, TrashBin, type DeskKind } from './stations/Props';
import { Table, type Seat } from './stations/Table';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { transfer, type ItemKind, type ItemStack } from './systems/ItemStack';
import { isComplete, orderTotal, remaining, type Order } from './systems/Order';
import { fmtMoney } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { buildShopBuilding, type LevelRefs } from './world/Level';
import { BIN_POS, EXTRA_MACHINE_SLOTS, HR_POS, MACHINE_SLOTS, MENU_POS, OFFICE_POS, STAFF_ENTRY, STAFF_HOMES, TABLE_POS, WORLD } from './world/layout';

export interface Carrier {
  stack: ItemStack;
  accepts: Set<ItemKind>;
  cd: number;
  isPlayer: boolean;
  /** Staff only pick up what they set out to fetch (null: nothing); the player takes anything. */
  wants?: ItemKind | null;
  /** Staff only drop at the counter they're taking it to (not one they pass on the way). */
  dropAt?: Counter | null;
  /** Staff carrying parts to the menu counter (the player always hands them over there). */
  toStation?: boolean;
}

/** Share of customers who ask for a boxed menu, once the shop has a menu counter. */
const MENU_SHARE = 0.4;

/** A celebrity customer pays this many times their order. */
const VIP_MULT = 5;

/** Share of a machine's top output that actually sells, for income estimates. */
export const SELL_THROUGH = 0.6;

/** Manager: seconds of history it looks at, pause between decisions, cash it never spends. */
const MANAGER_WINDOW = 30;
const MANAGER_COOLDOWN = 25;
const MANAGER_RESERVE = 20000;
/** Where the manager waits when there's nothing to do (near the register). */
const MANAGER_HOME: [number, number] = [-5.5, 3.5];

/** A shop's state within the save: döner at the top level, others nested. */
export function shopState(data: SaveData, id: ShopId): ShopState | undefined {
  return id === 'doner' ? data : data[id];
}

/** Rough TL/second a shop earns on its own, or 0 if it has no staff to run it. */
export function staffedIncome(data: SaveData, id: ShopId) {
  const st = shopState(data, id);
  if (!st || !st.hires.cashier || !st.hires.carrier) return 0;
  const lvl = st.upg.price ?? 0;
  return SHOPS[id].producers
    .filter((p) => !p.unlock || st.unlocked.includes(p.unlock))
    .reduce((sum, p) => sum + (priceOf(p.product, lvl) / PRODUCTS[p.product].interval) * SELL_THROUGH, 0);
}

/** What's been put into a shop: its fit-out, every unlock and extra machine. */
export function shopAssets(data: SaveData, id: ShopId) {
  const st = shopState(data, id);
  if (!st) return 0;
  const def = SHOPS[id];
  return def.openCost
    + def.unlocks.filter((u) => st.unlocked.includes(u.id)).reduce((sum, u) => sum + u.cost, 0)
    + (st.machines ?? []).reduce((sum, m) => sum + MACHINE_PRICE[m.product], 0);
}

export const formatOrder = (o: Order) =>
  (Object.entries(o) as [ProductKind, number][]).map(([k, n]) => `${n} ${TR.product[k]}`).join(', ');

/** Player upgrades belong to the player, not to a shop: they live on the top-level save. */
const PLAYER_UPGRADES: UpgradeId[] = ['pSpeed', 'pCap'];

/**
 * One shop on the high street. Everything inside works in the shop's local frame
 * (its `root` group sits at `ox` along the street), so the döner and burger shops
 * run side by side with the same layout.
 */
export class Shop {
  root = new THREE.Group();
  nav = new Nav(WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ);
  def: ShopDef;
  ss: ShopState;
  producers: Producer[] = [];
  counters: Counter[] = [];
  tables: Table[] = [];
  bin: TrashBin;
  office: Desk | null = null;
  hr: Desk | null = null;
  staff: Staff[] = [];
  customers: Customer[] = [];
  couriers: Courier[] = [];
  cars: Car[] = [];
  tiles: UnlockTile[] = [];
  /** Local obstacle rects; `rectsVersion` bumps whenever they change. */
  rects: Rect[] = [];
  rectsVersion = 0;
  served = 0;

  /** The manager's view of the last half-minute: samples each second, decides every so often. */
  private mgr = { t: 0, cool: 0, owed: [] as number[], dirty: [] as number[], idle: [] as number[] };
  /** Everything this shop sells, the menu included where there's a menu counter to buy. */
  readonly products: ProductKind[];
  menuStation: MenuStation | null = null;
  private level: LevelRefs;
  private spawnT = [1.5, 3];
  private onlineT = 6;
  private onlineOn = false;
  private playerLocal = new THREE.Vector3();

  constructor(public w: Game, public id: ShopId, public ox: number) {
    this.def = SHOPS[id];
    this.ss = shopState(w.data, id)!;
    this.products = [...new Set(this.def.producers.map((p) => p.product))];
    if (this.def.unlocks.some((u) => u.kind === 'menu')) this.products.push('menu');
    this.root.position.x = ox;
    w.scene.add(this.root);

    this.level = buildShopBuilding(this.root, id, this.def.theme);
    this.counters.push(new Counter(MAIN_COUNTER, this.products, this.def.theme.stripe, this.root, this.flyer));
    for (const p of this.def.producers) if (!p.unlock) this.addProducer(p.slot, p.product);
    this.bin = new TrashBin(BIN_POS, this.root);

    for (const uid of this.ss.unlocked) {
      const def = this.def.unlocks.find((u) => u.id === uid);
      if (def) this.applyUnlock(def, false);
    }
    for (const m of this.ss.machines ?? []) this.addProducer(m.slot, m.product);
    for (const h of this.def.hires) for (let i = 0; i < this.hireCount(h.id); i++) this.spawnStaff(h, false);
    this.onlineOn = this.onlineActive;
    this.rebuildNav();
    this.refreshTiles();
  }

  // ---------- world plumbing ----------

  get flyer() { return this.w.flyer; }
  get scene() { return this.w.scene; }
  get sfx() { return this.w.sfx; }
  get money() { return this.w.data.money; }

  toWorld(v: THREE.Vector3) { return new THREE.Vector3(v.x + this.ox, v.y, v.z); }

  worldRects(): Rect[] {
    return this.rects.map((r) => ({ x0: r.x0 + this.ox, x1: r.x1 + this.ox, z0: r.z0, z1: r.z1 }));
  }

  // ---------- stats ----------

  lvl(id: UpgradeId) {
    return (PLAYER_UPGRADES.includes(id) ? this.w.data.upg[id] : this.ss.upg[id]) ?? 0;
  }

  upgradeValue(id: UpgradeId, lvl: number) {
    switch (id) {
      case 'pSpeed': return BAL.player.speed + BAL.player.speedStep * lvl;
      case 'pCap': return BAL.player.cap + BAL.player.capStep * lvl;
      case 'price': return priceOf(this.def.main, lvl);
      case 'sSpeed': return BAL.staff.speed + BAL.staff.speedStep * lvl;
      case 'sCap': return BAL.staff.cap + BAL.staff.capStep * lvl;
    }
  }

  get staffSpeed() { return this.upgradeValue('sSpeed', this.lvl('sSpeed')); }
  get staffCap() { return this.upgradeValue('sCap', this.lvl('sCap')); }
  price(kind: ProductKind) { return priceOf(kind, this.lvl('price')); }

  incomePerSecond() {
    // The menu counter only repackages what the machines make (at a markup): leave it out.
    return this.producers
      .filter((p) => p.product !== 'menu')
      .reduce((s, p) => s + (this.price(p.product) / PRODUCTS[p.product].interval) * SELL_THROUGH, 0);
  }

  buyUpgrade(id: UpgradeId) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.lvl(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.max || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    (PLAYER_UPGRADES.includes(id) ? this.w.data.upg : this.ss.upg)[id] = lvl + 1;
    this.sfx.play('register', 1, 0);
    this.w.panel.render();
    writeSave(this.w.data);
  }

  // ---------- staff ----------

  hireCount(id: HireId) { return this.ss.hires[id] ?? 0; }

  hire(id: HireId, byManager = false) {
    const h = this.def.hires.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    const cost = hireCost(h, n);
    if (n >= hireMax(h) || this.w.data.money < cost) return;
    if (h.requires && !this.ss.unlocked.includes(h.requires)) return;
    this.w.data.money -= cost;
    this.ss.hires[id] = n + 1;
    this.spawnStaff(h, true);
    if (!byManager) this.sfx.play('unlock', 1, 0);
    if (!byManager) this.w.hud.toast(TR.hiredToast(TR.hire[id].name));
    else if (this.w.area === this) this.w.hud.toast(TR.managerHired(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  /** Let one of them go (the most recent hire). Nobody gets the hiring cost back. */
  fire(id: HireId, byManager = false) {
    const h = this.def.hires.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    if (!n) return;
    const counter = h.role === 'cashier' ? this.counters[h.counter ?? 0] : null;
    const candidates = this.staff.filter((s) => s.role === h.role && !s.leaving && (!counter || s.counter === counter));
    const s = candidates[candidates.length - 1];
    if (!s) return;
    s.dismiss();
    this.ss.hires[id] = n - 1;
    if (!byManager) this.w.hud.toast(TR.firedToast(TR.hire[id].name));
    else if (this.w.area === this) this.w.hud.toast(TR.managerFired(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  /** A fresh hire walks in through the door; loaded staff start at their spot. */
  private spawnStaff(h: HireDef, walkIn: boolean) {
    const counter = h.role === 'cashier' ? this.counters[h.counter ?? 0] : null;
    if (h.role === 'cashier' && !counter) return;
    let home: THREE.Vector3;
    if (counter) home = counter.cashierZone.clone();
    else if (h.role === 'manager') home = new THREE.Vector3(MANAGER_HOME[0], 0, MANAGER_HOME[1]);
    else {
      // Idle spots cycle; a big team spreads out a little so they don't stand in one another.
      const spots = STAFF_HOMES[h.role as 'carrier' | 'cleaner'];
      const i = this.staff.filter((s) => s.role === h.role).length;
      const [x, z] = spots[i % spots.length];
      home = new THREE.Vector3(x + Math.floor(i / spots.length) * 0.7, 0, z);
    }
    const from = walkIn ? new THREE.Vector3(STAFF_ENTRY[0] + (Math.random() - 0.5), 0, STAFF_ENTRY[1]) : undefined;
    const s = new Staff(h.role, counter, home, this, from);
    this.staff.push(s);
    this.root.add(s.ch.root);
  }

  // ---------- unlocks ----------

  unlockName(def: UnlockDef) {
    if (def.kind !== 'producer') return TR.unlockKind[def.kind];
    const p = this.def.producers.find((x) => x.unlock === def.id);
    return p ? TR.machine[p.product] : TR.unlockKind.producer;
  }

  private addProducer(slot: number, product: ProductKind) {
    const [x, z, rot] = MACHINE_SLOTS[slot];
    const p = new Producer(x, z, product, this.root, this.scene, this.flyer, rot);
    this.producers.push(p);
    return p;
  }

  // ---------- extra machines ----------

  /** Spare kitchen slots still free for extra machines. */
  freeMachineSlots() {
    const used = new Set((this.ss.machines ?? []).map((m) => m.slot));
    return EXTRA_MACHINE_SLOTS.filter((s) => !used.has(s));
  }

  /** Products that can get an extra machine: those the shop already makes. */
  machineProducts() { return this.availableProducts().filter((k) => k !== 'menu'); }

  buyMachine(kind: ProductKind) {
    const slot = this.freeMachineSlots()[0];
    const cost = MACHINE_PRICE[kind];
    if (slot === undefined || this.w.data.money < cost || !this.availableProducts().includes(kind)) return;
    this.w.data.money -= cost;
    (this.ss.machines ??= []).push({ product: kind, slot });
    const p = this.addProducer(slot, kind);
    this.rebuildNav();
    this.w.celebrate(p.group, this.toWorld(p.zone));
    this.w.hud.toast(TR.machineAdded(TR.machine[kind]));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  /** Products customers can order now: those with a machine installed. */
  private availableProducts() {
    return this.products.filter((k) => this.producers.some((p) => p.product === k));
  }

  private applyUnlock(def: UnlockDef, animate: boolean) {
    let obj: THREE.Object3D;
    const theme = this.def.theme;
    switch (def.kind) {
      case 'table': {
        const [x, z] = TABLE_POS[def.index!];
        const t = new Table(x, z, this.root, this.flyer, theme.chair, theme.chairDark);
        this.tables.push(t);
        obj = t.group;
        break;
      }
      case 'producer': {
        const pd = this.def.producers.find((p) => p.unlock === def.id)!;
        obj = this.addProducer(pd.slot, pd.product).group;
        break;
      }
      case 'office':
        this.office = new Desk(OFFICE_POS, this.root, 'office');
        obj = this.office.group;
        break;
      case 'hr':
        this.hr = new Desk(HR_POS, this.root, 'hr');
        obj = this.hr.group;
        break;
      case 'menu': {
        const [x, z, rot] = MENU_POS;
        this.menuStation = new MenuStation(x, z, this.root, this.scene, this.flyer, rot);
        this.producers.push(this.menuStation);
        obj = this.menuStation.group;
        break;
      }
      case 'window': {
        this.level.windowWall.visible = false;
        const k = new Counter(WINDOW_COUNTER, this.products, theme.stripe, this.root, this.flyer);
        this.counters.push(k);
        obj = k.group;
        break;
      }
    }
    this.rebuildNav();
    if (!animate) return;
    this.w.celebrate(obj, this.toWorld(new THREE.Vector3(def.x, 0, def.z)));
    this.w.hud.toast(def.kind === 'menu' ? TR.menuOpened : TR.unlocked(this.unlockName(def)));
  }

  private rebuildNav() {
    this.rects = [
      ...this.level.rects,
      ...this.producers.map((p) => p.rect),
      ...this.counters.map((k) => k.rect),
      ...this.tables.map((t) => t.rect),
      this.bin.rect,
      ...[this.office, this.hr].filter((d): d is Desk => !!d).flatMap((d) => d.rects),
    ];
    this.nav.rebuild(this.rects);
    this.rectsVersion++;
  }

  private refreshTiles() {
    const locked = this.def.unlocks.filter((u) => !this.ss.unlocked.includes(u.id)).slice(0, 2);
    const wanted: TileDef[] = locked.map((u) => ({ id: u.id, cost: u.cost, x: u.x, z: u.z, label: this.unlockName(u) }));
    this.tiles = this.tiles.filter((t) => {
      if (wanted.some((w) => w.id === t.def.id)) return true;
      t.dispose();
      return false;
    });
    for (const w of wanted) {
      if (!this.tiles.some((t) => t.def.id === w.id)) this.tiles.push(new UnlockTile(w, this.ss.paid[w.id] ?? 0, this.root));
    }
  }

  private updateTiles(dt: number, p: THREE.Vector3) {
    for (const tile of [...this.tiles]) {
      tile.update(this.w.reduced ? 0 : this.w.time);
      if (this.w.payTile(tile, dist2(p, tile.pos) < 0.95 * 0.95, dt, this.ss.paid)) this.completeUnlock(tile);
    }
  }

  private completeUnlock(tile: UnlockTile) {
    delete this.ss.paid[tile.def.id];
    tile.dispose();
    this.tiles = this.tiles.filter((t) => t !== tile);
    const def = this.def.unlocks.find((u) => u.id === tile.def.id)!;
    this.ss.unlocked.push(def.id);
    this.applyUnlock(def, true);
    this.refreshTiles();
    this.w.onShopProgress(this);
    writeSave(this.w.data);
  }

  // ---------- customers & serving ----------

  findSeat(): Seat | null {
    const free: Seat[] = [];
    for (const t of this.tables) {
      if (t.dirty) continue;
      for (const s of t.seats) if (!s.occupant) free.push(s);
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  /**
   * The main product, plus a chance of each extra the shop can make. Once there's a
   * menu counter, some customers ask for a boxed menu (or two) instead.
   */
  private makeOrder(maxMain: number): Order {
    const main = this.def.main;
    const kinds = this.availableProducts();
    if (kinds.includes('menu') && Math.random() < MENU_SHARE) return { menu: Math.random() < 0.3 ? 2 : 1 };
    const o: Order = { [main]: 1 + Math.floor(Math.random() * maxMain) };
    for (const k of kinds) {
      if (k !== main && k !== 'menu' && Math.random() < 0.6) o[k] = Math.random() < 0.3 ? 2 : 1;
    }
    return o;
  }

  private spawnInterval(i: number) {
    const n = this.producers.length;
    const base = i === 0
      ? Math.max(1.6, 5.5 - 0.7 * n - 0.2 * this.tables.length)
      : Math.max(2.5, 6 - 0.5 * n);
    return (base * (0.8 + Math.random() * 0.4)) / this.w.events.footfall;
  }

  /** A celebrity joins the main queue, whatever its length: serve them and they pay five times over. */
  spawnVip() {
    this.spawnCustomer(this.counters[0], true);
  }

  private spawnCustomer(k: Counter, vip = false) {
    // Up to 2 of the main product from the start, 3 once the shop has grown a bit.
    const order = this.makeOrder(Math.min(BAL.maxOrder, 2 + Math.floor(this.ss.unlocked.length / 4)));
    if (k.def.drive) {
      const car = new Car(k, this, order);
      k.queue.push(car);
      car.goTo(this.nav, k.slot(k.queue.length - 1));
      this.cars.push(car);
      return;
    }
    const c = new Customer(k, this, order, vip);
    c.pos.set(k.spawn.x + (Math.random() - 0.5) * 3, 0, k.spawn.z);
    this.root.add(c.ch.root);
    k.queue.push(c);
    c.goTo(this.nav, k.slot(k.queue.length - 1));
    this.customers.push(c);
  }

  private updateCustomers(dt: number) {
    this.counters.forEach((k, i) => {
      this.spawnT[i] -= dt;
      if (this.spawnT[i] > 0) return;
      this.spawnT[i] = this.spawnInterval(i);
      if (k.queue.length < k.def.maxQueue && this.customers.length < BAL.maxCustomers) this.spawnCustomer(k);
    });
    for (const c of this.customers) c.update(dt);
    this.customers = this.customers.filter((c) => !c.dead);
    for (const c of this.cars) c.update(dt);
    this.cars = this.cars.filter((c) => !c.dead);
  }

  private updateCounters(dt: number, p: THREE.Vector3) {
    for (const k of this.counters) {
      k.playerHere = dist2(p, k.cashierZone) < 0.8 * 0.8;
      k.serveT -= dt;
      const c = k.queue[0];
      if (!c || !c.arrived || !k.cashierPresent || k.serveT > 0) continue;
      // Hand over whatever part of the order the counter has.
      const next = remaining(c.order, c.got).find(([kind]) => k.stocks.get(kind)?.count);
      if (!next) continue;
      const kind = next[0];
      transfer(k.stocks.get(kind)!, c.stack, 0.3);
      c.got[kind] = (c.got[kind] ?? 0) + 1;
      k.serveT = BAL.serveInterval;
      if (k.playerHere) this.sfx.play('serve');
      if (isComplete(c.order, c.got)) this.completeOrder(k, c);
    }
  }

  private orderValue(o: Order, markup = 0) {
    return (Object.entries(o) as [ProductKind, number][])
      .reduce((sum, [k, n]) => sum + Math.round(this.price(k) * (1 + markup)) * n, 0);
  }

  private leaveQueue(k: Counter, c: QueueMember) {
    const i = k.queue.indexOf(c);
    if (i < 0) return;
    k.queue.splice(i, 1);
    k.queue.forEach((q, j) => { if (j >= i) q.goTo(this.nav, k.slot(j)); });
  }

  private completeOrder(k: Counter, c: QueueMember) {
    this.leaveQueue(k, c);
    // Couriers are paid on delivery, not at the till.
    if (c instanceof Courier) {
      this.sfx.play('serve', 1, 0);
      c.collected();
      return;
    }
    // Walk-in and drive-thru customers pay at the till, straight into the shop's account;
    // a well-groomed shopkeeper (barber visit) gets a tip on top.
    const at = new THREE.Vector3();
    if (c instanceof Car) at.copy(this.toWorld(new THREE.Vector3(c.pos.x + 0.9, 1.1, c.pos.z)));
    else (c as Customer).ch.hand.getWorldPosition(at);
    const vip = c instanceof Customer && c.vip;
    const mult = this.w.bonusMult() * (1 + buffAmount(this.w.data.buffs, 'tips')) * (vip ? VIP_MULT : 1);
    // After a public offering, part of the takings belongs to the shareholders.
    const amount = Math.round(this.orderValue(c.order) * mult * this.w.ownerShare(this.id));
    this.w.sale(amount);
    this.w.floats.spawn(at, `+${fmtMoney(amount)}`);
    if (vip) this.w.events.vipServed(amount);
    this.sfx.play('register', 1, 150);
    this.served++;
    if (c instanceof Car) c.served();
    else (c as Customer).served(k.def.dine && Math.random() < BAL.dineChance);
  }

  /**
   * Someone in the queue waited too long and walks out without buying.
   * Only those not yet being served give up: once food is on the way they wait.
   */
  gaveUp(c: QueueMember, head: THREE.Vector3) {
    for (const k of this.counters) this.leaveQueue(k, c);
    if (c instanceof Courier) this.w.hud.toast(TR.patience.courierLeft);
    if (c instanceof Customer && c.vip) this.w.events.vipLeft();
    this.w.floats.spawn(head, TR.patience.left, 'angry');
  }

  // ---------- online orders ----------

  private get onlineActive() {
    return this.ss.unlocked.includes(BAL.online.startsAfter);
  }

  private updateOnline(dt: number) {
    if (!this.onlineActive) return;
    const o = BAL.online;
    if (!this.onlineOn) {
      this.onlineOn = true;
      this.onlineT = 8;
      this.w.hud.toast(TR.onlineStart);
    }
    this.onlineT -= dt;
    const k = this.counters[0];
    if (this.onlineT <= 0) {
      const ev = this.w.events.online;
      this.onlineT = (o.interval[0] + Math.random() * (o.interval[1] - o.interval[0])) / ev.rate;
      if (this.couriers.length < o.maxActive + ev.extra && k.queue.length < k.def.maxQueue + ev.extra) {
        const order = this.makeOrder(o.maxOrder);
        this.couriers.push(new Courier(this, k, order));
        this.sfx.play('order', 1, 0);
        if (this.w.area === this) this.w.hud.toast(TR.onlineNew(formatOrder(order)));
      }
    }
    for (const x of this.couriers) x.update(dt);
    this.couriers = this.couriers.filter((x) => !x.dead);
  }

  /** Paid on delivery: online prices (shop price + markup), minus the courier's fee. */
  onlineDelivered(c: Courier) {
    const gross = this.orderValue(c.order, BAL.online.markup);
    const fee = BAL.online.courierFee;
    const net = Math.round((gross - fee) * this.w.bonusMult() * this.w.ownerShare(this.id));
    this.w.sale(net);
    this.w.data.stats!.online++;
    const p = this.w.player.pos;
    this.w.floats.spawn(new THREE.Vector3(p.x, 2.2, p.z), `+${fmtMoney(net)}`);
    this.sfx.play('register', 1, 0);
    if (this.w.area === this) this.w.hud.toast(TR.onlineDone(fmtMoney(net), fmtMoney(gross), fmtMoney(fee)));
  }

  // ---------- carrying ----------

  /** One pick-up/drop-off step for a carrier standing at local `p`. */
  interact(c: Carrier, p: THREE.Vector3) {
    if (c.cd > 0) return;
    const st = c.stack;
    for (const m of this.producers) {
      if (!m.tray.count || !c.accepts.has(m.product) || !st.canAccept(m.product) || dist2(p, m.zone) > 1.1 * 1.1) continue;
      if (c.wants !== undefined && c.wants !== m.product) continue;
      transfer(m.tray, st);
      c.cd = BAL.transferInterval;
      if (c.isPlayer) this.sfx.play('pickup', 1 + st.count * 0.04);
      return;
    }
    // Parts for the menu counter: the player hands over whatever it can use; staff only when sent.
    const ms = this.menuStation;
    if (ms && st.kind && (c.isPlayer || c.toStation) && ms.wants(st.kind as ProductKind) && dist2(p, ms.zone) < 1.1 * 1.1) {
      transfer(st, ms.inputs.get(st.kind as ProductKind)!);
      c.cd = BAL.transferInterval;
      if (c.isPlayer) this.sfx.play('drop');
      return;
    }
    if (st.kind && st.kind !== 'trash') {
      for (const k of this.counters) {
        const pile = k.stocks.get(st.kind as ProductKind);
        if (c.dropAt !== undefined && c.dropAt !== k) continue;
        if (!pile || dist2(p, k.dropZone) >= 1 || !pile.canAccept(st.kind)) continue;
        transfer(st, pile);
        c.cd = BAL.transferInterval;
        if (c.isPlayer) this.sfx.play('drop');
        return;
      }
    }
    if (c.accepts.has('trash') && st.canAccept('trash') && (c.wants === undefined || c.wants === 'trash')) {
      for (const t of this.tables) {
        if (t.trash.count && dist2(p, t.center) < 1.7 * 1.7) {
          transfer(t.trash, st);
          c.cd = BAL.transferInterval;
          if (c.isPlayer) this.sfx.play('pickup', 0.8);
          return;
        }
      }
    }
    if (st.kind === 'trash' && dist2(p, this.bin.pos) < 1.4 * 1.4) {
      const o = st.take()!;
      this.flyer.fly(o, this.bin.anchor, new THREE.Vector3(), { dur: 0.3, onDone: () => o.removeFromParent() });
      c.cd = BAL.transferInterval;
      if (c.isPlayer) this.sfx.play('trash');
    }
  }

  /** Items of `kind` still owed to everyone queuing (at one counter, or all). */
  queueDemand(kind: ProductKind, at?: Counter) {
    let n = 0;
    for (const k of at ? [at] : this.counters) {
      for (const q of k.queue) for (const [kk, left] of remaining(q.order, q.got)) if (kk === kind) n += left;
    }
    return n;
  }

  /** Items of `kind` ready on the counter(s). */
  counterStock(kind: ProductKind, at?: Counter) {
    return (at ? [at] : this.counters).reduce((n, k) => n + (k.stocks.get(kind)?.count ?? 0), 0);
  }

  /** Desk the player (local position) is standing at, if any. */
  deskAt(p: THREE.Vector3): DeskKind | null {
    const d = [this.office, this.hr].find((x) => x && dist2(p, x.zone) < 0.8 * 0.8);
    return d?.kind ?? null;
  }

  /** Customers in and around the shop, for the crowd ambience. */
  get crowd() { return this.customers.length; }

  /** Items still owed across the queue (for tests and staff heuristics). */
  get demand() { return this.counters.reduce((n, k) => n + k.queue.reduce((m, q) => m + orderTotal(q.order), 0), 0); }

  // ---------- the manager ----------

  /**
   * With a manager on the payroll the shop staffs itself: every register gets a
   * cashier, a growing backlog gets another waiter, lingering mess gets a cleaner,
   * and a team standing idle loses a waiter. Always keeps a cash reserve.
   */
  private manage(dt: number) {
    if (!this.staff.some((s) => s.role === 'manager' && !s.leaving)) return;
    const m = this.mgr;
    m.t += dt;
    m.cool -= dt;
    if (m.t < 1) return;
    m.t = 0;
    const workers = this.staff.filter((s) => (s.role === 'carrier' || s.role === 'cleaner') && !s.leaving);
    const owed = this.products.reduce((n, kind) =>
      n + this.counters.reduce((a, k) => a + Math.max(0, this.queueDemand(kind, k) - this.counterStock(kind, k)), 0), 0);
    const idle = workers.length ? workers.filter((s) => !s.stack.count && !s.wants).length / workers.length : 0;
    const push = (a: number[], v: number) => { a.push(v); if (a.length > MANAGER_WINDOW) a.shift(); };
    push(m.owed, owed);
    push(m.dirty, this.tables.filter((t) => t.dirty).length);
    push(m.idle, idle);
    if (m.cool > 0 || m.owed.length < MANAGER_WINDOW / 2) return;

    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const affordable = (id: HireId) => {
      const h = this.def.hires.find((x) => x.id === id)!;
      const n = this.hireCount(id);
      return n < hireMax(h) && (!h.requires || this.ss.unlocked.includes(h.requires))
        && this.w.data.money >= hireCost(h, n) + MANAGER_RESERVE;
    };
    const act = (fn: () => void) => {
      fn();
      m.cool = MANAGER_COOLDOWN;
      m.owed = []; m.dirty = []; m.idle = [];
    };
    const registers: HireId[] = ['cashier', 'cashierWindow'];
    for (const [i, k] of this.counters.entries()) {
      if (!k.staffCashier && affordable(registers[i])) return act(() => this.hire(registers[i], true));
    }
    const carriers = this.hireCount('carrier');
    if (avg(m.owed) > 3 + workers.length && avg(m.idle) < 0.2 && affordable('carrier')) return act(() => this.hire('carrier', true));
    if (avg(m.dirty) >= 2 && affordable('cleaner')) return act(() => this.hire('cleaner', true));
    if (avg(m.idle) > 0.5 && avg(m.owed) < 2 && carriers > 1) return act(() => this.fire('carrier', true));
  }

  // ---------- frame ----------

  /** `player` is the player's world position; `playerHere` whether they're inside this shop's plot. */
  update(dt: number, player: THREE.Vector3, playerHere: boolean) {
    const p = this.playerLocal.set(player.x - this.ox, 0, player.z);
    for (const m of this.producers) m.update(dt);
    for (const s of this.staff) {
      s.update(dt);
      if (s.role !== 'cashier' && !s.leaving) this.interact(s, s.pos);
    }
    // Fired staff who've walked out of the door.
    for (const s of this.staff.filter((x) => x.gone)) s.ch.root.removeFromParent();
    this.staff = this.staff.filter((s) => !s.gone);
    // Far-away positions keep the player out of this shop's zones.
    this.updateCounters(dt, playerHere ? p : new THREE.Vector3(1e4, 0, 1e4));
    this.updateCustomers(dt);
    this.updateOnline(dt);
    this.manage(dt);
    if (playerHere) this.updateTiles(dt, p);
  }
}
