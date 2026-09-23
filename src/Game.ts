import * as THREE from 'three';
import { BAL, HIRES, UNLOCKS, UPGRADES, upgradeCost, type HireDef, type HireId, type UnlockDef, type UpgradeId } from './config/balance';
import { Sfx } from './core/Audio';
import { Flyer } from './core/Flyer';
import { Input } from './core/Input';
import { Nav, type Rect } from './core/Nav';
import { loadSave, writeSave, type SaveData } from './core/Save';
import { easeOutQuart, Tweens } from './core/Tween';
import { dist2 } from './entities/Agent';
import { Car } from './entities/Car';
import { Courier } from './entities/Courier';
import { Customer } from './entities/Customer';
import { Player } from './entities/Player';
import { Staff } from './entities/Staff';
import { Counter, MAIN_COUNTER, WINDOW_COUNTER, type QueueMember } from './stations/Counter';
import { DonerSpit } from './stations/DonerSpit';
import { Desk, TrashBin, type DeskKind } from './stations/Props';
import { Table, type Seat } from './stations/Table';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { Confetti, FloatingText, makeArrow } from './systems/Effects';
import { transfer, type ItemKind, type ItemStack } from './systems/ItemStack';
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

const BURGER_TILE: TileDef = { id: 'burger', cost: 0, x: BURGER_GATE[0], z: BURGER_GATE[1], label: TR.burgerName };
const TUTORIAL_STEPS = TR.hints.length;

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
  player: Player;
  spits: DonerSpit[] = [];
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

  private level: LevelRefs;
  private rects: Rect[] = [];
  private tiles: UnlockTile[] = [];
  private confetti: Confetti;
  private floats: FloatingText;
  private arrow: ReturnType<typeof makeArrow>;
  private spawnT = [1.5, 3];
  private onlineT = 6;
  private onlineOn = false;
  private saveT = 0;
  private time = 0;
  private last = 0;
  private deskInside: DeskKind | null = null;
  private gateInside = false;
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

    this.level = buildLevel(this.scene);
    this.counters.push(new Counter(MAIN_COUNTER, this.scene, this.flyer));
    this.spits.push(new DonerSpit(SPIT_POS[0][0], SPIT_POS[0][1], this.scene, this.flyer));
    this.bin = new TrashBin(BIN_POS, this.scene);

    this.data = initialSave ?? loadSave();
    this.migrateSave();
    this.sfx.enabled = this.data.sound;
    this.player = new Player(this.flyer, () => this.playerCap);
    this.player.pos.set(START_POS[0], 0, START_POS[1]);
    this.player.ch.setYaw(Math.PI);
    this.scene.add(this.player.ch.root);

    for (const id of this.data.unlocked) {
      const def = UNLOCKS.find((u) => u.id === id);
      if (def) this.applyUnlock(def, false);
    }
    for (const h of HIRES) for (let i = 0; i < this.hireCount(h.id); i++) this.spawnStaff(h, false);
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
    this.hud.setProgress(this.data.unlocked.length, UNLOCKS.length);
    this.panel = new UpgradePanel(this);
    this.savePanel = new SavePanel(this);
    this.confetti = new Confetti(this.scene);
    this.floats = new FloatingText(this.scene, this.tweens, this.reduced);
    this.arrow = makeArrow();
    this.scene.add(this.arrow.group);

    this.grantOffline();

    addEventListener('resize', this.resize);
    this.resize();
    const persist = () => writeSave(this.data);
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  }

  // ---------- stats ----------

  get money() { return this.data.money; }
  lvl(id: UpgradeId) { return this.data.upg[id] ?? 0; }

  upgradeValue(id: UpgradeId, lvl: number) {
    switch (id) {
      case 'pSpeed': return BAL.player.speed + BAL.player.speedStep * lvl;
      case 'pCap': return BAL.player.cap + BAL.player.capStep * lvl;
      case 'price': return BAL.price.base + BAL.price.step * lvl;
      case 'sSpeed': return BAL.staff.speed + BAL.staff.speedStep * lvl;
      case 'sCap': return BAL.staff.cap + BAL.staff.capStep * lvl;
    }
  }

  get playerSpeed() { return this.upgradeValue('pSpeed', this.lvl('pSpeed')); }
  get playerCap() { return this.upgradeValue('pCap', this.lvl('pCap')); }
  get price() { return this.upgradeValue('price', this.lvl('price')); }
  get staffSpeed() { return this.upgradeValue('sSpeed', this.lvl('sSpeed')); }
  get staffCap() { return this.upgradeValue('sCap', this.lvl('sCap')); }

  incomePerSecond() {
    return (this.spits.length * this.price) / BAL.spit.interval * 0.6;
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
    this.data.upg[id] = lvl + 1;
    this.sfx.play('register', 1, 0);
    this.panel.render();
    writeSave(this.data);
  }

  // ---------- staff ----------

  hireCount(id: HireId) { return this.data.hires[id] ?? 0; }

  hire(id: HireId) {
    const h = HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    if (n >= h.costs.length || this.data.money < h.costs[n]) return;
    if (h.requires && !this.data.unlocked.includes(h.requires)) return;
    this.data.money -= h.costs[n];
    this.data.hires[id] = n + 1;
    this.spawnStaff(h, true);
    this.sfx.play('unlock', 1, 0);
    this.hud.toast(TR.hiredToast(TR.hire[id].name));
    this.panel.render();
    writeSave(this.data);
  }

  /** A fresh hire walks in through the door; loaded staff start at their spot. */
  private spawnStaff(h: HireDef, walkIn: boolean) {
    const counter = h.role === 'cashier' ? this.counters[h.counter ?? 0] : null;
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

  /** Saves from before the HR desk kept staff as floor unlocks; turn them into hires. */
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
    d.unlocked = d.unlocked.filter((id) => UNLOCKS.some((u) => u.id === id));
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
    return TR.unlockKind[def.kind];
  }

  private applyUnlock(def: UnlockDef, animate: boolean) {
    let obj: THREE.Object3D;
    switch (def.kind) {
      case 'table': {
        const [x, z] = TABLE_POS[def.index!];
        const t = new Table(x, z, this.scene, this.flyer);
        this.tables.push(t);
        obj = t.group;
        break;
      }
      case 'spit': {
        const [x, z] = SPIT_POS[def.index!];
        const s = new DonerSpit(x, z, this.scene, this.flyer);
        this.spits.push(s);
        obj = s.group;
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
        const k = new Counter(WINDOW_COUNTER, this.scene, this.flyer);
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
      ...this.spits.map((s) => s.rect),
      ...this.counters.map((k) => k.rect),
      ...this.tables.map((t) => t.rect),
      this.bin.rect,
      ...[this.office, this.hr].filter((d): d is Desk => !!d).map((d) => d.rect),
    ];
    this.nav.rebuild(this.rects);
  }

  private refreshTiles() {
    const locked = UNLOCKS.filter((u) => !this.data.unlocked.includes(u.id)).slice(0, 2);
    const wanted: TileDef[] = locked.length
      ? locked.map((u) => ({ id: u.id, cost: u.cost, x: u.x, z: u.z, label: this.unlockName(u) }))
      : [BURGER_TILE];
    this.tiles = this.tiles.filter((t) => {
      if (wanted.some((w) => w.id === t.def.id)) return true;
      t.dispose();
      return false;
    });
    for (const w of wanted) {
      if (!this.tiles.some((t) => t.def.id === w.id)) this.tiles.push(new UnlockTile(w, this.data.paid[w.id] ?? 0, this.scene));
    }
  }

  private updateTiles(dt: number) {
    for (const tile of [...this.tiles]) {
      tile.update(this.reduced ? 0 : this.time);
      const inside = dist2(this.player.pos, tile.pos) < 0.95 * 0.95;
      if (tile.def.id === 'burger') {
        if (inside && !this.gateInside) this.hud.toast(TR.burgerSoon);
        this.gateInside = inside;
        continue;
      }
      if (!inside) { tile.hold = 0; continue; }
      tile.hold += dt;
      // Crossing a 1.9 m tile at walking speed takes ~0.4 s; only a deliberate stop pays.
      if (tile.hold < 0.5 || this.data.money < 1) continue;
      const rate = Math.max(tile.def.cost / 1.3, 40);
      const amt = Math.min(this.data.money, tile.remaining, rate * dt);
      this.data.money -= amt;
      tile.paid += amt;
      this.data.paid[tile.def.id] = tile.paid;
      tile.draw();
      this.sfx.play('tick', 1 + (tile.paid / tile.def.cost) * 1.5, 70);
      if (tile.remaining <= 0.001) this.completeUnlock(tile);
    }
  }

  private completeUnlock(tile: UnlockTile) {
    const def = UNLOCKS.find((u) => u.id === tile.def.id)!;
    this.data.unlocked.push(def.id);
    delete this.data.paid[def.id];
    tile.dispose();
    this.tiles = this.tiles.filter((t) => t !== tile);
    this.applyUnlock(def, true);
    this.refreshTiles();
    this.hud.setProgress(this.data.unlocked.length, UNLOCKS.length);
    writeSave(this.data);
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

  private spawnInterval(i: number) {
    const base = i === 0
      ? Math.max(1.6, 5.5 - 0.7 * this.spits.length - 0.2 * this.tables.length)
      : Math.max(2.5, 6 - 0.5 * this.spits.length);
    return base * (0.8 + Math.random() * 0.4);
  }

  private spawnCustomer(k: Counter) {
    // Orders of up to 2 from the start, 3 once the shop has grown a bit.
    const maxWant = Math.min(BAL.maxOrder, 2 + Math.floor(this.data.unlocked.length / 4));
    const want = 1 + Math.floor(Math.random() * maxWant);
    if (k.def.drive) {
      const car = new Car(k, this.scene, this.flyer, want);
      k.queue.push(car);
      car.goTo(this.nav, k.slot(k.queue.length - 1));
      this.cars.push(car);
      return;
    }
    const c = new Customer(k, this, want);
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
      if (!c || !c.arrived || !k.cashierPresent || k.serveT > 0 || !k.stock.count) continue;
      transfer(k.stock, c.stack, 0.3);
      c.got++;
      k.serveT = BAL.serveInterval;
      if (k.playerHere) this.sfx.play('serve');
      if (c.got >= c.want) this.completeOrder(k, c);
    }
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
    const amount = c.got * this.price * mult;
    this.addMoney(amount);
    this.floats.spawn(at, `+${fmtMoney(amount)}`);
    this.sfx.play('register', 1, 150);
    this.served++;
    if (c instanceof Car) c.served();
    else (c as Customer).served(k.def.dine && Math.random() < BAL.dineChance);
  }

  // ---------- online orders ----------

  private get onlineActive() {
    return this.data.unlocked.includes(BAL.online.startsAfter);
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
        const want = 1 + Math.floor(Math.random() * o.maxOrder);
        this.couriers.push(new Courier(this, k, want));
        this.sfx.play('order', 1, 0);
        this.hud.toast(TR.onlineNew(want));
      }
    }
    for (const x of this.couriers) x.update(dt);
    this.couriers = this.couriers.filter((x) => !x.dead);
  }

  /** Paid on delivery: online price per döner, minus the courier's fee. */
  onlineDelivered(c: Courier) {
    const gross = c.want * (this.price + BAL.online.markup);
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
    if (c.accepts.has('doner') && st.canAccept('doner')) {
      for (const s of this.spits) {
        if (s.tray.count && dist2(p, s.zone) < 1.1 * 1.1) {
          transfer(s.tray, st);
          c.cd = BAL.transferInterval;
          if (c.isPlayer) this.sfx.play('pickup', 1 + st.count * 0.04);
          return;
        }
      }
    }
    if (st.kind === 'doner') {
      for (const k of this.counters) {
        if (dist2(p, k.dropZone) < 1 && k.stock.canAccept('doner')) {
          transfer(st, k.stock);
          c.cd = BAL.transferInterval;
          if (c.isPlayer) this.sfx.play('drop');
          return;
        }
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

  private grantOffline() {
    if (!this.data.t || !this.hireCount('cashier') || !this.hireCount('carrier')) return;
    const secs = Math.min((Date.now() - this.data.t) / 1000, BAL.offlineCapSec);
    const earn = Math.floor(secs * this.incomePerSecond() * BAL.offlineRate);
    if (earn < 1) return;
    this.data.money += earn;
    setTimeout(() => this.hud.toast(TR.offline(fmtMoney(earn))), 600);
  }

  private tutorialTarget(step: number): THREE.Vector3 | null {
    const k = this.counters[0];
    switch (step) {
      case 0: return this.spits[0].zone;
      case 1: return k.dropZone;
      case 2: return k.cashierZone;
      case 3: return this.tiles.find((t) => t.def.id === 'table1')?.pos ?? null;
      default: return null;
    }
  }

  private tutorialDone(step: number) {
    const k = this.counters[0];
    switch (step) {
      case 0: return this.player.stack.kind === 'doner' || k.stock.count > 0;
      case 1: return k.stock.count > 0 || this.served > 0;
      case 2: return this.served > 0;
      case 3: return this.data.unlocked.includes('table1');
      default: return true;
    }
  }

  private updateTutorial() {
    while (this.data.tut < TUTORIAL_STEPS && this.tutorialDone(this.data.tut)) this.data.tut++;
    const step = this.data.tut;
    const target = step < TUTORIAL_STEPS ? this.tutorialTarget(step) : null;
    this.hud.setHint(target ? TR.hints[step] : null);
    const a = this.arrow;
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
    const near = Math.min(...this.spits.map((s) => Math.sqrt(dist2(p, s.zone))));
    const kitchen = Math.max(0, Math.min(1, 1 - (near - 1) / 10));
    this.sfx.update(dt, this.customers.length, kitchen, this.spits.length);
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
    for (const s of this.spits) s.update(dt, BAL.spit.interval);
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
