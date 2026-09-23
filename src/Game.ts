import * as THREE from 'three';
import {
  BAL, PRODUCTS, priceOf, SHOPS, UPGRADES, upgradeCost,
  type HireDef, type HireId, type ProductKind, type ShopDef, type ShopId, type UnlockDef, type UpgradeId,
} from './config/balance';
import { Sfx } from './core/Audio';
import { Flyer } from './core/Flyer';
import { Input } from './core/Input';
import { Nav, type Rect } from './core/Nav';
import { freshShop, loadSave, writeSave, type SaveData, type ShopState } from './core/Save';
import { easeOutQuart, Tweens } from './core/Tween';
import { dist2 } from './entities/Agent';
import { Car } from './entities/Car';
import { Courier } from './entities/Courier';
import { Customer } from './entities/Customer';
import { Player } from './entities/Player';
import { Staff } from './entities/Staff';
import { Counter, MAIN_COUNTER, WINDOW_COUNTER, type QueueMember } from './stations/Counter';
import { Producer } from './stations/Producer';
import { Desk, TrashBin, type DeskKind } from './stations/Props';
import { Table, type Seat } from './stations/Table';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { Confetti, FloatingText, makeArrow } from './systems/Effects';
import { transfer, type ItemKind, type ItemStack } from './systems/ItemStack';
import { isComplete, remaining, type Order } from './systems/Order';
import { fmtMoney, Hud } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { SavePanel } from './ui/SavePanel';
import { UpgradePanel } from './ui/UpgradePanel';
import { buildLevel, type LevelRefs } from './world/Level';
import { BIN_POS, BURGER_GATE, HR_POS, OFFICE_POS, SPIT_POS, STAFF_ENTRY, STAFF_HOMES, START_POS, TABLE_POS, WORLD } from './world/layout';

interface Carrier {
  pos: THREE.Vector3;
  stack: ItemStack;
  accepts: Set<ItemKind>;
  cd: number;
  isPlayer: boolean;
}

const TUTORIAL_STEPS = TR.hints.length;
const GATE_ID = 'gate';
/** Share of a machine's top output that actually sells, for income estimates. */
const SELL_THROUGH = 0.6;

const otherShop = (id: ShopId): ShopId => (id === 'doner' ? 'burger' : 'doner');

/** A shop's state within the save: döner at the top level, others nested. */
function shopState(data: SaveData, id: ShopId): ShopState | undefined {
  return id === 'doner' ? data : data[id];
}

/** Rough TL/second a shop earns on its own, or 0 if it has no staff to run it. */
function staffedIncome(data: SaveData, id: ShopId) {
  const st = shopState(data, id);
  if (!st || !st.hires.cashier || !st.hires.carrier) return 0;
  const lvl = st.upg.price ?? 0;
  return SHOPS[id].producers
    .filter((p) => !p.unlock || st.unlocked.includes(p.unlock))
    .reduce((sum, p) => sum + (priceOf(p.product, lvl) / PRODUCTS[p.product].interval) * SELL_THROUGH, 0);
}

export const formatOrder = (o: Order) =>
  (Object.entries(o) as [ProductKind, number][]).map(([k, n]) => `${n} ${TR.product[k]}`).join(', ');

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(24, 1, 0.5, 200);
  flyer = new Flyer(this.scene);
  tweens = new Tweens();
  sfx = new Sfx();
  nav = new Nav(WORLD.minX, WORLD.minZ, WORLD.maxX, WORLD.maxZ);
  input: Input;
  hud: Hud;
  panel: UpgradePanel;
  savePanel: SavePanel;
  data: SaveData;
  /** The shop the player is in, and its part of the save. */
  shop: ShopDef;
  ss: ShopState;
  player: Player;
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
  cashMultiplierUntil = 0;

  private products: ProductKind[];
  private level: LevelRefs;
  private rects: Rect[] = [];
  private tiles: UnlockTile[] = [];
  private confetti: Confetti;
  private floats: FloatingText;
  private arrow: ReturnType<typeof makeArrow>;
  private spawnT = [1.5, 3];
  private onlineT = 6;
  private onlineOn = false;
  private idleT = 0;
  private saveT = 0;
  private time = 0;
  private last = 0;
  private deskInside: DeskKind | null = null;
  private travelling = false;
  private served = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private camTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, initialSave?: SaveData) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color('#E8D9BF');
    this.scene.fog = new THREE.Fog('#E8D9BF', 48, 90);
    this.scene.add(new THREE.HemisphereLight('#FFF4E0', '#B89A7A', 1.25));
    const sun = new THREE.DirectionalLight('#FFE8C8', 1.9);
    sun.position.set(8, 20, 10);
    sun.target.position.set(-2, 0, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 22, bottom: -22, near: 1, far: 60 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.data = initialSave ?? loadSave();
    this.migrateSave();
    const shopId: ShopId = this.data.shop === 'burger' && this.data.burger ? 'burger' : 'doner';
    this.shop = SHOPS[shopId];
    this.ss = shopState(this.data, shopId)!;
    this.products = [...new Set(this.shop.producers.map((p) => p.product))];

    const other = otherShop(shopId);
    const gateNote = shopState(this.data, other) ? TR.gate.go : TR.gate.open;
    this.level = buildLevel(this.scene, shopId, this.shop.theme, gateNote);
    this.counters.push(new Counter(MAIN_COUNTER, this.products, this.shop.theme.stripe, this.scene, this.flyer));
    for (const p of this.shop.producers) if (!p.unlock) this.addProducer(p.slot, p.product);
    this.bin = new TrashBin(BIN_POS, this.scene);

    this.sfx.enabled = this.data.sound;
    this.player = new Player(this.flyer, () => this.playerCap);
    this.player.pos.set(START_POS[0], 0, START_POS[1]);
    this.player.ch.setYaw(Math.PI);
    this.scene.add(this.player.ch.root);

    for (const id of this.ss.unlocked) {
      const def = this.shop.unlocks.find((u) => u.id === id);
      if (def) this.applyUnlock(def, false);
    }
    for (const h of this.shop.hires) for (let i = 0; i < this.hireCount(h.id); i++) this.spawnStaff(h, false);
    this.onlineOn = this.onlineActive;
    this.rebuildNav();
    this.refreshTiles();

    this.input = new Input(canvas, document.getElementById('joy')!, document.getElementById('joy-knob')!);
    this.input.onFirstGesture = () => this.sfx.unlock();
    this.hud = new Hud(this.data.sound, () => {
      this.data.sound = this.sfx.enabled = !this.sfx.enabled;
      writeSave(this.data);
      return this.data.sound;
    });
    this.hud.setProgress(this.ss.unlocked.length, this.shop.unlocks.length);
    this.panel = new UpgradePanel(this);
    this.savePanel = new SavePanel(this);
    this.confetti = new Confetti(this.scene);
    this.floats = new FloatingText(this.scene, this.tweens, this.reduced);
    this.arrow = makeArrow();
    this.scene.add(this.arrow.group);

    this.grantOffline();
    const idle = staffedIncome(this.data, other) * BAL.idleRate;
    if (idle > 0) setTimeout(() => this.hud.toast(TR.gate.idle(TR.shopName[other], fmtMoney(idle * 60))), 1800);

    addEventListener('resize', this.resize);
    this.resize();
    const persist = () => writeSave(this.data);
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  }

  // ---------- stats ----------

  get money() { return this.data.money; }
  lvl(id: UpgradeId) { return this.ss.upg[id] ?? 0; }

  upgradeValue(id: UpgradeId, lvl: number) {
    switch (id) {
      case 'pSpeed': return BAL.player.speed + BAL.player.speedStep * lvl;
      case 'pCap': return BAL.player.cap + BAL.player.capStep * lvl;
      case 'price': return priceOf(this.shop.main, lvl);
      case 'sSpeed': return BAL.staff.speed + BAL.staff.speedStep * lvl;
      case 'sCap': return BAL.staff.cap + BAL.staff.capStep * lvl;
    }
  }

  get playerSpeed() { return this.upgradeValue('pSpeed', this.lvl('pSpeed')); }
  get playerCap() { return this.upgradeValue('pCap', this.lvl('pCap')); }
  get staffSpeed() { return this.upgradeValue('sSpeed', this.lvl('sSpeed')); }
  get staffCap() { return this.upgradeValue('sCap', this.lvl('sCap')); }
  price(kind: ProductKind) { return priceOf(kind, this.lvl('price')); }

  /** Main product's price (the "Döner/Burger Fiyatı" upgrade row). */
  get mainPrice() { return this.price(this.shop.main); }

  incomePerSecond() {
    return this.producers.reduce((s, p) => s + (this.price(p.product) / PRODUCTS[p.product].interval) * SELL_THROUGH, 0);
  }

  addMoney(v: number) {
    this.data.money += v;
  }

  buyUpgrade(id: UpgradeId) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.lvl(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.max || this.data.money < cost) return;
    this.data.money -= cost;
    this.ss.upg[id] = lvl + 1;
    this.sfx.play('register', 1, 0);
    this.panel.render();
    writeSave(this.data);
  }

  // ---------- staff ----------

  hireCount(id: HireId) { return this.ss.hires[id] ?? 0; }

  hire(id: HireId) {
    const h = this.shop.hires.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    if (n >= h.costs.length || this.data.money < h.costs[n]) return;
    if (h.requires && !this.ss.unlocked.includes(h.requires)) return;
    this.data.money -= h.costs[n];
    this.ss.hires[id] = n + 1;
    this.spawnStaff(h, true);
    this.sfx.play('unlock', 1, 0);
    this.hud.toast(TR.hiredToast(TR.hire[id].name));
    this.panel.render();
    writeSave(this.data);
  }

  /** A fresh hire walks in through the door; loaded staff start at their spot. */
  private spawnStaff(h: HireDef, walkIn: boolean) {
    const counter = h.role === 'cashier' ? this.counters[h.counter ?? 0] : null;
    if (h.role === 'cashier' && !counter) return;
    let home: THREE.Vector3;
    if (counter) home = counter.cashierZone.clone();
    else {
      const spots = STAFF_HOMES[h.role as 'carrier' | 'cleaner'];
      const [x, z] = spots[this.staff.filter((s) => s.role === h.role).length % spots.length];
      home = new THREE.Vector3(x, 0, z);
    }
    const from = walkIn ? new THREE.Vector3(STAFF_ENTRY[0] + (Math.random() - 0.5), 0, STAFF_ENTRY[1]) : undefined;
    const s = new Staff(h.role, counter, home, this, from);
    this.staff.push(s);
    this.scene.add(s.ch.root);
  }

  /** Old döner saves: staff that were floor unlocks, and prices 40× smaller. */
  private migrateSave() {
    const legacy: [string, HireId][] = [
      ['cashier1', 'cashier'], ['cashier2', 'cashierWindow'],
      ['carrier1', 'carrier'], ['carrier2', 'carrier'], ['cleaner1', 'cleaner'],
    ];
    const d = this.data;
    let hadStaff = false;
    for (const [old, id] of legacy) {
      delete d.paid[old];
      if (!d.unlocked.includes(old)) continue;
      d.hires[id] = (d.hires[id] ?? 0) + 1;
      hadStaff = true;
    }
    d.unlocked = d.unlocked.filter((id) => SHOPS.doner.unlocks.some((u) => u.id === id));
    if (hadStaff && !d.unlocked.includes('hr')) d.unlocked.push('hr');

    // v1 → v2: prices moved to real lira (döner 5 → 200). Scale money by the same 40×
    // and refund half-paid tiles, since their costs changed by different ratios.
    if (d.v < 2) {
      d.money = (d.money + Object.values(d.paid).reduce((a, b) => a + b, 0)) * 40;
      d.paid = {};
      d.v = 2;
    }
  }

  // ---------- unlocks ----------

  private unlockName(def: UnlockDef) {
    if (def.kind !== 'producer') return TR.unlockKind[def.kind];
    const p = this.shop.producers.find((x) => x.unlock === def.id);
    return p ? TR.machine[p.product] : TR.unlockKind.producer;
  }

  private addProducer(slot: number, product: ProductKind) {
    const [x, z] = SPIT_POS[slot];
    const p = new Producer(x, z, product, this.scene, this.flyer);
    this.producers.push(p);
    return p;
  }

  /** Products customers can order now: those with a machine installed. */
  private availableProducts() {
    return this.products.filter((k) => this.producers.some((p) => p.product === k));
  }

  private applyUnlock(def: UnlockDef, animate: boolean) {
    let obj: THREE.Object3D;
    const theme = this.shop.theme;
    switch (def.kind) {
      case 'table': {
        const [x, z] = TABLE_POS[def.index!];
        const t = new Table(x, z, this.scene, this.flyer, theme.chair, theme.chairDark);
        this.tables.push(t);
        obj = t.group;
        break;
      }
      case 'producer': {
        const pd = this.shop.producers.find((p) => p.unlock === def.id)!;
        obj = this.addProducer(pd.slot, pd.product).group;
        break;
      }
      case 'office':
        this.office = new Desk(OFFICE_POS, this.scene, 'office');
        obj = this.office.group;
        break;
      case 'hr':
        this.hr = new Desk(HR_POS, this.scene, 'hr');
        obj = this.hr.group;
        break;
      case 'window': {
        this.level.windowWall.visible = false;
        const k = new Counter(WINDOW_COUNTER, this.products, theme.stripe, this.scene, this.flyer);
        this.counters.push(k);
        obj = k.group;
        break;
      }
    }
    this.rebuildNav();
    if (!animate) return;
    if (!this.reduced) {
      const base = obj.scale.clone();
      this.tweens.add(0.45, (k) => obj.scale.copy(base).multiplyScalar(Math.max(0.01, easeOutQuart(k))));
      this.confetti.burst(new THREE.Vector3(def.x, 0, def.z));
    }
    this.sfx.play('unlock', 1, 0);
    this.hud.toast(TR.unlocked(this.unlockName(def)));
  }

  private rebuildNav() {
    this.rects = [
      ...this.level.rects,
      ...this.producers.map((p) => p.rect),
      ...this.counters.map((k) => k.rect),
      ...this.tables.map((t) => t.rect),
      this.bin.rect,
      ...[this.office, this.hr].filter((d): d is Desk => !!d).map((d) => d.rect),
    ];
    this.nav.rebuild(this.rects);
  }

  /**
   * The roadside gate to the other shop: a paid tile the first time (the döner
   * shop, once complete), a free travel tile after that.
   */
  private gateTile(): TileDef | null {
    const other = otherShop(this.shop.id);
    const [x, z] = BURGER_GATE;
    const name = TR.shopName[other];
    if (shopState(this.data, other)) return { id: GATE_ID, cost: 0, x, z, label: TR.gate.goTile(name), note: '→' };
    const allDone = this.ss.unlocked.length >= this.shop.unlocks.length;
    return allDone ? { id: GATE_ID, cost: SHOPS[other].openCost, x, z, label: name } : null;
  }

  private refreshTiles() {
    const locked = this.shop.unlocks.filter((u) => !this.ss.unlocked.includes(u.id)).slice(0, 2);
    const wanted: TileDef[] = locked.map((u) => ({ id: u.id, cost: u.cost, x: u.x, z: u.z, label: this.unlockName(u) }));
    const gate = this.gateTile();
    if (gate) wanted.push(gate);
    this.tiles = this.tiles.filter((t) => {
      if (wanted.some((w) => w.id === t.def.id && w.cost === t.def.cost)) return true;
      t.dispose();
      return false;
    });
    for (const w of wanted) {
      if (!this.tiles.some((t) => t.def.id === w.id)) this.tiles.push(new UnlockTile(w, this.ss.paid[w.id] ?? 0, this.scene));
    }
  }

  private updateTiles(dt: number) {
    for (const tile of [...this.tiles]) {
      tile.update(this.reduced ? 0 : this.time);
      const inside = dist2(this.player.pos, tile.pos) < 0.95 * 0.95;
      if (!inside) { tile.hold = 0; continue; }
      tile.hold += dt;
      // Crossing a 1.9 m tile at walking speed takes ~0.4 s; only a deliberate stop counts.
      if (tile.hold < 0.5) continue;
      if (tile.def.cost === 0) {
        this.travel(otherShop(this.shop.id));
        return;
      }
      if (this.data.money < 1) continue;
      const rate = Math.max(tile.def.cost / 1.3, 40);
      const amt = Math.min(this.data.money, tile.remaining, rate * dt);
      this.data.money -= amt;
      tile.paid += amt;
      this.ss.paid[tile.def.id] = tile.paid;
      tile.draw();
      this.sfx.play('tick', 1 + (tile.paid / tile.def.cost) * 1.5, 70);
      if (tile.remaining <= 0.001) this.completeUnlock(tile);
    }
  }

  private completeUnlock(tile: UnlockTile) {
    delete this.ss.paid[tile.def.id];
    tile.dispose();
    this.tiles = this.tiles.filter((t) => t !== tile);
    if (tile.def.id === GATE_ID) {
      // The new shop is open: set it up and go there.
      const other = otherShop(this.shop.id);
      if (other === 'burger') this.data.burger = freshShop();
      this.sfx.play('unlock', 1, 0);
      this.hud.toast(TR.gate.opened(TR.shopName[other]));
      this.confetti.burst(tile.pos);
      setTimeout(() => this.travel(other), 1200);
      return;
    }
    const def = this.shop.unlocks.find((u) => u.id === tile.def.id)!;
    this.ss.unlocked.push(def.id);
    this.applyUnlock(def, true);
    this.refreshTiles();
    this.hud.setProgress(this.ss.unlocked.length, this.shop.unlocks.length);
    writeSave(this.data);
  }

  /** Switch shops: save, then reload into the other one. */
  private travel(to: ShopId) {
    if (this.travelling || !shopState(this.data, to)) return;
    this.travelling = true;
    this.data.shop = to;
    writeSave(this.data);
    location.reload();
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

  /** The main product, plus a chance of each extra the shop can make. */
  private makeOrder(maxMain: number): Order {
    const main = this.shop.main;
    const o: Order = { [main]: 1 + Math.floor(Math.random() * maxMain) };
    for (const k of this.availableProducts()) {
      if (k !== main && Math.random() < 0.6) o[k] = Math.random() < 0.3 ? 2 : 1;
    }
    return o;
  }

  private spawnInterval(i: number) {
    const n = this.producers.length;
    const base = i === 0
      ? Math.max(1.6, 5.5 - 0.7 * n - 0.2 * this.tables.length)
      : Math.max(2.5, 6 - 0.5 * n);
    return base * (0.8 + Math.random() * 0.4);
  }

  private spawnCustomer(k: Counter) {
    // Up to 2 of the main product from the start, 3 once the shop has grown a bit.
    const order = this.makeOrder(Math.min(BAL.maxOrder, 2 + Math.floor(this.ss.unlocked.length / 4)));
    if (k.def.drive) {
      const car = new Car(k, this.scene, this.flyer, order);
      k.queue.push(car);
      car.goTo(this.nav, k.slot(k.queue.length - 1));
      this.cars.push(car);
      return;
    }
    const c = new Customer(k, this, order);
    c.pos.set(k.spawn.x + (Math.random() - 0.5) * 3, 0, k.spawn.z);
    this.scene.add(c.ch.root);
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

  private updateCounters(dt: number) {
    for (const k of this.counters) {
      k.playerHere = dist2(this.player.pos, k.cashierZone) < 0.8 * 0.8;
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

  private completeOrder(k: Counter, c: QueueMember) {
    k.queue.shift();
    k.queue.forEach((q, i) => q.goTo(this.nav, k.slot(i)));
    // Couriers are paid on delivery, not at the till.
    if (c instanceof Courier) {
      this.sfx.play('serve', 1, 0);
      c.collected();
      return;
    }
    // Walk-in and drive-thru customers pay at the till, straight into the shop's account.
    const at = new THREE.Vector3();
    if (c instanceof Car) at.set(c.pos.x + 0.9, 1.1, c.pos.z);
    else (c as Customer).ch.hand.getWorldPosition(at);
    const mult = performance.now() < this.cashMultiplierUntil ? 2 : 1;
    const amount = this.orderValue(c.order) * mult;
    this.addMoney(amount);
    this.floats.spawn(at, `+${fmtMoney(amount)}`);
    this.sfx.play('register', 1, 150);
    this.served++;
    if (c instanceof Car) c.served();
    else (c as Customer).served(k.def.dine && Math.random() < BAL.dineChance);
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
      this.hud.toast(TR.onlineStart);
    }
    this.onlineT -= dt;
    const k = this.counters[0];
    if (this.onlineT <= 0) {
      this.onlineT = o.interval[0] + Math.random() * (o.interval[1] - o.interval[0]);
      if (this.couriers.length < o.maxActive && k.queue.length < k.def.maxQueue) {
        const order = this.makeOrder(o.maxOrder);
        this.couriers.push(new Courier(this, k, order));
        this.sfx.play('order', 1, 0);
        this.hud.toast(TR.onlineNew(formatOrder(order)));
      }
    }
    for (const x of this.couriers) x.update(dt);
    this.couriers = this.couriers.filter((x) => !x.dead);
  }

  /** Paid on delivery: online prices (shop price + markup), minus the courier's fee. */
  onlineDelivered(c: Courier) {
    const gross = this.orderValue(c.order, BAL.online.markup);
    const fee = BAL.online.courierFee;
    const net = gross - fee;
    this.addMoney(net);
    this.floats.spawn(new THREE.Vector3(this.player.pos.x, 2.2, this.player.pos.z), `+${fmtMoney(net)}`);
    this.sfx.play('register', 1, 0);
    this.hud.toast(TR.onlineDone(fmtMoney(net), fmtMoney(gross), fmtMoney(fee)));
  }

  // ---------- carrying ----------

  private interact(c: Carrier) {
    if (c.cd > 0) return;
    const p = c.pos;
    const st = c.stack;
    for (const m of this.producers) {
      if (!m.tray.count || !c.accepts.has(m.product) || !st.canAccept(m.product) || dist2(p, m.zone) > 1.1 * 1.1) continue;
      transfer(m.tray, st);
      c.cd = BAL.transferInterval;
      if (c.isPlayer) this.sfx.play('pickup', 1 + st.count * 0.04);
      return;
    }
    if (st.kind && st.kind !== 'trash') {
      for (const k of this.counters) {
        const pile = k.stocks.get(st.kind);
        if (!pile || dist2(p, k.dropZone) >= 1 || !pile.canAccept(st.kind)) continue;
        transfer(st, pile);
        c.cd = BAL.transferInterval;
        if (c.isPlayer) this.sfx.play('drop');
        return;
      }
    }
    if (c.accepts.has('trash') && st.canAccept('trash')) {
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
      return;
    }
  }

  // ---------- misc systems ----------

  /** Staffed shops keep earning (at a reduced rate) while the game is closed. */
  private grantOffline() {
    if (!this.data.t) return;
    const secs = Math.min((Date.now() - this.data.t) / 1000, BAL.offlineCapSec);
    const rate = staffedIncome(this.data, 'doner') + staffedIncome(this.data, 'burger');
    const earn = Math.floor(secs * rate * BAL.offlineRate);
    if (earn < 1) return;
    this.data.money += earn;
    setTimeout(() => this.hud.toast(TR.offline(fmtMoney(earn))), 600);
  }

  /** The shop the player isn't in keeps selling through its staff. */
  private updateIdleIncome(dt: number) {
    this.idleT += dt;
    if (this.idleT < 1) return;
    const rate = staffedIncome(this.data, otherShop(this.shop.id)) * BAL.idleRate;
    this.addMoney(rate * this.idleT);
    this.idleT = 0;
  }

  private tutorialTarget(step: number): THREE.Vector3 | null {
    const k = this.counters[0];
    switch (step) {
      case 0: return this.producers[0].zone;
      case 1: return k.dropZone;
      case 2: return k.cashierZone;
      case 3: return this.tiles.find((t) => t.def.id === 'table1')?.pos ?? null;
      default: return null;
    }
  }

  private tutorialDone(step: number) {
    const k = this.counters[0];
    switch (step) {
      case 0: return this.player.stack.kind === this.shop.main || k.stockCount > 0;
      case 1: return k.stockCount > 0 || this.served > 0;
      case 2: return this.served > 0;
      case 3: return this.ss.unlocked.includes('table1');
      default: return true;
    }
  }

  private updateTutorial() {
    const a = this.arrow;
    // The tutorial belongs to the first shop only.
    if (this.shop.id !== 'doner') {
      a.group.visible = false;
      this.hud.setHint(null);
      return;
    }
    while (this.data.tut < TUTORIAL_STEPS && this.tutorialDone(this.data.tut)) this.data.tut++;
    const step = this.data.tut;
    const target = step < TUTORIAL_STEPS ? this.tutorialTarget(step) : null;
    this.hud.setHint(target ? TR.hints[step] : null);
    a.group.visible = !!target;
    if (target) {
      const t = this.reduced ? 0 : this.time;
      a.group.position.set(target.x, 0, target.z);
      a.cone.position.y = 1.7 + Math.sin(t * 5) * 0.15;
      a.cone.rotation.y = t;
      a.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    }
  }

  private updateDesks() {
    const desk = [this.office, this.hr].find((d) => d && dist2(this.player.pos, d.zone) < 0.8 * 0.8) ?? null;
    const kind = desk?.kind ?? null;
    if (kind && kind !== this.deskInside) {
      this.savePanel.close();
      this.panel.open(kind);
    }
    if (!kind && this.deskInside) this.panel.close();
    this.deskInside = kind;
  }

  private updateAmbience(dt: number) {
    const p = this.player.pos;
    const near = Math.min(...this.producers.map((m) => Math.sqrt(dist2(p, m.zone))));
    const kitchen = Math.max(0, Math.min(1, 1 - (near - 1) / 10));
    this.sfx.update(dt, this.customers.length, kitchen, this.producers.length);
  }

  private resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private updateCamera(dt: number, snap = false) {
    const a = this.camera.aspect;
    const f = a < 0.75 ? 1.55 : a < 1.2 ? 1.25 : 1;
    const p = this.player.pos;
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.camTarget.x += (p.x - this.camTarget.x) * k;
    this.camTarget.z += (p.z - this.camTarget.z) * k;
    // Narrow FOV from further back keeps verticals upright, like the genre's near-orthographic look.
    this.camera.position.set(this.camTarget.x, 23 * f, this.camTarget.z + 16.5 * f);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 0.6);
  }

  private update(dt: number) {
    this.time += dt;
    this.player.update(dt, this.input.move, this.playerSpeed, this.rects);
    for (const m of this.producers) m.update(dt);
    this.interact(this.player);
    for (const s of this.staff) {
      s.update(dt);
      if (s.role !== 'cashier') this.interact(s);
    }
    this.updateCounters(dt);
    this.updateCustomers(dt);
    this.updateOnline(dt);
    this.updateTiles(dt);
    this.updateDesks();
    this.updateIdleIncome(dt);
    this.flyer.update(dt);
    this.tweens.update(dt);
    this.confetti.update(dt);
    this.updateTutorial();
    this.updateCamera(dt);
    this.hud.setMoney(this.data.money);
    this.panel.update(dt);
    this.updateAmbience(dt);
    this.saveT += dt;
    if (this.saveT > 5) {
      this.saveT = 0;
      writeSave(this.data);
    }
  }

  start() {
    this.updateCamera(0, true);
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
