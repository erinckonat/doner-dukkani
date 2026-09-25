import * as THREE from 'three';
import { BAL, hireCost, hireMax, UPGRADES, upgradeCost, type HireId, type UpgradeId } from './config/balance';
import { CAR_MARGIN, CAR_MODELS, carModel, type CarModel } from './config/cars';
import { DEALS, GALLERY, GALLERY_HIRES, GALLERY_OPEN_COST, GALLERY_ORIGIN, GALLERY_UNLOCKS } from './config/gallery';
import { Nav, type Rect } from './core/Nav';
import { writeSave, type SaveData, type ShopState } from './core/Save';
import { Agent, dist2 } from './entities/Agent';
import { Character, LOOKS, pick } from './entities/Character';
import type { Game } from './Game';
import { Door } from './stations/Door';
import { Desk } from './stations/Props';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { fmtMoney } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { at, box, C, canvasTexture, cyl, floorDecal, makePlant, roundRect } from './world/Assets';
import { plane } from './world/Level';
import { padRing } from './world/Neighborhood';
import { makeCarModel } from './world/Vehicles';

export type GalleryState = ShopState & {
  /** The car on each turntable (model id), or null while one is on its way. */
  stock: (string | null)[];
  sold: number;
};

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const freshGallery = (): GalleryState => ({
  unlocked: [], paid: {}, upg: {}, hires: {}, stock: [randomModel().id, randomModel().id, null, null, null], sold: 0,
});

function randomModel(): CarModel {
  let r = Math.random() * CAR_MODELS.reduce((s, c) => s + c.weight, 0);
  return CAR_MODELS.find((c) => (r -= c.weight) <= 0) ?? CAR_MODELS[0];
}

export function galleryAssets(data: SaveData) {
  const gs = data.gallery;
  if (!gs) return 0;
  return GALLERY_OPEN_COST + GALLERY_UNLOCKS.filter((u) => gs.unlocked.includes(u.id)).reduce((s, u) => s + u.cost, 0);
}

/** Rough TL/second the gallery clears with a salesperson on the floor. */
export function galleryRate(gs: GalleryState) {
  const podiums = 2 + GALLERY_UNLOCKS.filter((u) => gs.unlocked.includes(u.id)).length;
  const avg = CAR_MODELS.reduce((s, c) => s + c.price * c.weight, 0) / CAR_MODELS.reduce((s, c) => s + c.weight, 0);
  // A turntable turns over a car every restock plus the time it takes someone to buy it.
  return (podiums * avg * CAR_MARGIN) / (DEALS.restock + 30);
}

export function galleryStaffedIncome(data: SaveData) {
  const gs = data.gallery;
  return gs && gs.hires.salesperson ? galleryRate(gs) : 0;
}

interface Podium {
  index: number;
  pos: THREE.Vector3;
  open: boolean;
  table: THREE.Group;
  car: THREE.Group | null;
  model: CarModel | null;
  restockT: number;
  /** Someone has asked to buy this one. */
  claimed: boolean;
}

/** A shopper at the gallery: looks a car over, perhaps asks to buy it, then leaves. */
class Buyer extends Agent {
  state: 'toCar' | 'look' | 'queue' | 'leaving' = 'toCar';
  dead = false;
  timer = 0;
  constructor(private gal: Gallery, public podium: Podium, from: THREE.Vector3) {
    super({ shirt: pick(['#2E3A55', '#3E6B5A', '#6B2E2E', '#3A3F4A', '#8A6A4A', '#E9E4DA']), pants: pick(LOOKS.pants), skin: pick(LOOKS.skins), hair: pick(LOOKS.hair) });
    this.speed = BAL.customerSpeed * rand(0.9, 1.1);
    this.pos.copy(from);
    this.goTo(gal.nav, gal.viewSpot(podium));
  }

  update(dt: number) {
    this.step(dt);
    if (this.state === 'toCar' && this.arrived) {
      this.state = 'look';
      this.timer = rand(4, 7);
      const p = this.podium.pos;
      this.ch.face(p.x - this.pos.x, p.z - this.pos.z, 1);
    } else if (this.state === 'look') {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.podium.model && !this.podium.claimed && Math.random() < DEALS.buyChance) this.gal.joinQueue(this);
      else this.leave();
    } else if (this.state === 'leaving' && this.arrived) {
      this.ch.root.removeFromParent();
      this.dead = true;
    }
  }

  leave() {
    this.state = 'leaving';
    this.goTo(this.gal.nav, v(rand(-12, 12), GALLERY.street + 1));
  }
}

/**
 * The car gallery. Its own local frame (origin GALLERY_ORIGIN, the street is +z):
 * turntables with cars, a sales desk, the garage ring (buy yourself a car) and the
 * HR desk. Low walls all round so the camera sees in, glass doors at the front.
 */
export class Gallery {
  readonly id = 'gallery' as const;
  def = { hires: GALLERY_HIRES };
  root = new THREE.Group();
  nav = new Nav(-15, -11, 15, 15);
  rectsVersion = 0;
  podiums: Podium[] = [];
  buyers: Buyer[] = [];
  queue: Buyer[] = [];

  private ox = GALLERY_ORIGIN.x;
  private oz = GALLERY_ORIGIN.z;
  private rects: Rect[] = [];
  private wallRects: Rect[] = [];
  private tiles: UnlockTile[] = [];
  private hr: Desk;
  private door: Door;
  private seller: Character | null = null;
  private playerLocal = new THREE.Vector3();
  private sellerZone = v(GALLERY.seller[0], GALLERY.seller[1]);
  private garageZone = v(GALLERY.garage[0], GALLERY.garage[1]);
  private spawnT = 2;
  private dealT = 0;
  private leaving: { obj: THREE.Object3D; path: THREE.Vector3[]; t: number }[] = [];
  private time = 0;

  constructor(public w: Game) {
    this.root.position.set(this.ox, 0, this.oz);
    w.scene.add(this.root);
    this.buildShell();
    GALLERY.podiums.forEach(([x, z], i) => this.podiums.push(this.buildPodium(i, x, z)));
    this.hr = new Desk(GALLERY.hr, this.root, 'hr');
    this.door = new Door(this.root, { x: 0, z: GALLERY.halfD + 0.15, width: GALLERY.door.x1 - GALLERY.door.x0, height: 2.4, style: 'slide', color: '#1F2A3A' });
    if (this.hireCount('salesperson')) this.spawnSeller();
    this.rebuildNav();
    this.refreshTiles();
  }

  get ss() { return this.w.data.gallery!; }
  get sfx() { return this.w.sfx; }
  get crowd() { return this.buyers.length; }
  toLocal(p: THREE.Vector3) { return this.playerLocal.set(p.x - this.ox, 0, p.z - this.oz); }
  toWorld(p: THREE.Vector3) { return new THREE.Vector3(p.x + this.ox, p.y, p.z + this.oz); }
  persist() {}

  worldRects(): Rect[] {
    return this.rects.map((r) => ({ x0: r.x0 + this.ox, x1: r.x1 + this.ox, z0: r.z0 + this.oz, z1: r.z1 + this.oz }));
  }

  // ---------- building ----------

  private wall(r: Rect, h: number, color: string) {
    const m = box(r.x1 - r.x0, h, r.z1 - r.z0, color);
    m.position.set((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);
    this.root.add(m);
    this.root.add(at(box(r.x1 - r.x0 + 0.04, 0.05, r.z1 - r.z0 + 0.04, '#9FA6AD', false), m.position.x, h + 0.025, m.position.z));
    this.wallRects.push(r);
    return m;
  }

  private buildShell() {
    const { halfW: W, halfD: D } = GALLERY;
    const T = 0.3;
    // Polished dark floor with light tiles.
    const floor = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#E9E6E0';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#D6D1C8';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 128, 128);
    }).tex;
    floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(W / 1.5, D / 1.5);
    this.root.add(at(plane(2 * W, 2 * D, floor, 0), 0, 0.003, 0));
    this.wall({ x0: -W - T, x1: W + T, z0: -D - T, z1: -D }, 3.2, '#1F2A3A').castShadow = false;
    this.wall({ x0: -W - T, x1: -W, z0: -D, z1: D }, 1.4, '#D9DDE0');
    this.wall({ x0: W, x1: W + T, z0: -D, z1: D }, 1.4, '#D9DDE0');
    this.wall({ x0: -W - T, x1: GALLERY.door.x0, z0: D, z1: D + T }, 0.5, '#D9DDE0');
    this.wall({ x0: GALLERY.door.x1, x1: W + T, z0: D, z1: D + T }, 0.5, '#D9DDE0');
    // Big name on the back wall.
    const sign = canvasTexture(1024, 160, (ctx) => {
      ctx.fillStyle = '#1F2A3A';
      ctx.fillRect(0, 0, 1024, 160);
      ctx.fillStyle = C.gold;
      ctx.font = '800 104px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.gallery.name.toLocaleUpperCase('tr-TR'), 512, 88);
    }).tex;
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.5), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }));
    sm.position.set(0, 1.9, -D + 0.02);
    this.root.add(sm);
    // Sales desk, with its ring behind.
    const [dx, dz] = GALLERY.desk;
    this.root.add(at(box(3.2, 1.0, 0.8, '#1F2A3A'), dx, 0.5, dz));
    this.root.add(at(box(3.26, 0.06, 0.86, '#E9E6E0', false), dx, 1.03, dz));
    this.root.add(at(box(0.5, 0.32, 0.04, C.dark), dx + 0.8, 1.25, dz - 0.1));
    this.wallRects.push({ x0: dx - 1.6, x1: dx + 1.6, z0: dz - 0.4, z1: dz + 0.4 });
    const ring = padRing(TR.gallery.sellRing, C.gold);
    ring.position.set(this.sellerZone.x, 0.02, this.sellerZone.z);
    this.root.add(ring);
    const garage = padRing(TR.gallery.garageRing, '#2F5D8C');
    garage.position.set(this.garageZone.x, 0.02, this.garageZone.z);
    this.root.add(garage);
    for (const x of [-W + 0.6, W - 0.6]) {
      this.root.add(at(makePlant(), x, 0, D - 0.6));
      this.wallRects.push({ x0: x - 0.3, x1: x + 0.3, z0: D - 0.9, z1: D - 0.3 });
    }
  }

  /** A turntable: a low round platform that slowly turns the car on it. */
  private buildPodium(index: number, x: number, z: number): Podium {
    const open = index < 2 || this.ss.unlocked.includes(GALLERY_UNLOCKS[index - 2].id);
    const table = new THREE.Group();
    table.position.set(x, 0, z);
    if (open) {
      table.add(at(cyl(2.3, 2.4, 0.18, 24, '#3A3F4A'), 0, 0.09, 0));
      // A gold rim round the edge of the turntable.
      const rim = new THREE.Mesh(new THREE.TorusGeometry(2.26, 0.05, 6, 32), new THREE.MeshStandardMaterial({ color: C.gold, roughness: 0.4 }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.19;
      table.add(rim);
    } else {
      // Not yet bought: just its outline on the floor, under the price tile.
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.35, 32), new THREE.MeshBasicMaterial({ color: '#B9B2A6' }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.006;
      table.add(ring);
    }
    this.root.add(table);
    const p: Podium = { index, pos: v(x, z), open, table, car: null, model: null, restockT: DEALS.restock, claimed: false };
    if (open) {
      this.wallRects.push({ x0: x - 2.2, x1: x + 2.2, z0: z - 2.2, z1: z + 2.2 });
      const id = this.ss.stock[index];
      if (id) this.placeCar(p, carModel(id), false);
    }
    return p;
  }

  private placeCar(p: Podium, model: CarModel, animate: boolean) {
    const car = makeCarModel(model.style, model.paint).root;
    car.position.y = 0.2;
    car.rotation.y = rand(0, Math.PI * 2);
    // Price tag on a stand at the front of the turntable.
    const tag = canvasTexture(384, 160, (ctx) => {
      ctx.fillStyle = C.cream;
      roundRect(ctx, 6, 6, 372, 148, 22);
      ctx.fill();
      ctx.fillStyle = C.dark;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 46px "Baloo 2", sans-serif';
      ctx.fillText(model.name, 192, 56);
      ctx.fillStyle = '#B5262B';
      ctx.font = '800 50px "Baloo 2", sans-serif';
      ctx.fillText(fmtMoney(model.price * (1 + CAR_MARGIN)), 192, 116);
    }).tex;
    const label = floorDecal(tag, 2.2);
    label.scale.y = 160 / 384;
    const g = new THREE.Group();
    g.add(car);
    p.table.add(g);
    label.position.set(p.pos.x, 0.03, p.pos.z + 2.9);
    this.root.add(label);
    g.userData.label = label;
    p.car = g;
    p.model = model;
    p.claimed = false;
    this.ss.stock[p.index] = model.id;
    if (animate) this.w.celebrate(g, this.toWorld(p.pos.clone()));
  }

  /** Where a buyer stands to look a car over: beside the turntable, towards the middle. */
  viewSpot(p: Podium) {
    const side = p.pos.x < -0.5 ? 1 : p.pos.x > 0.5 ? -1 : 0;
    return side ? v(p.pos.x + side * 3, p.pos.z + 0.8) : v(p.pos.x + rand(-1.5, 1.5), p.pos.z + 3.2);
  }

  private rebuildNav() {
    this.rects = [...this.wallRects, ...this.hr.rects];
    this.nav.rebuild(this.rects);
    this.rectsVersion++;
  }

  // ---------- unlocks ----------

  private refreshTiles() {
    const locked = GALLERY_UNLOCKS.filter((u) => !this.ss.unlocked.includes(u.id)).slice(0, 2);
    this.tiles = this.tiles.filter((t) => {
      if (locked.some((u) => u.id === t.def.id)) return true;
      t.dispose();
      return false;
    });
    for (const u of locked) {
      if (this.tiles.some((t) => t.def.id === u.id)) continue;
      const [x, z] = GALLERY.podiums[u.index];
      const def: TileDef = { id: u.id, cost: u.cost, x, z, label: TR.gallery.podium };
      this.tiles.push(new UnlockTile(def, this.ss.paid[u.id] ?? 0, this.root));
    }
  }

  private updateTiles(dt: number, p: THREE.Vector3) {
    for (const tile of [...this.tiles]) {
      tile.update(this.w.reduced ? 0 : this.w.time);
      if (!this.w.payTile(tile, dist2(p, tile.pos) < 0.95 * 0.95, dt, this.ss.paid)) continue;
      const u = GALLERY_UNLOCKS.find((x) => x.id === tile.def.id)!;
      delete this.ss.paid[u.id];
      tile.dispose();
      this.tiles = this.tiles.filter((t) => t !== tile);
      this.ss.unlocked.push(u.id);
      const old = this.podiums[u.index];
      old.table.removeFromParent();
      const [x, z] = GALLERY.podiums[u.index];
      const pod = this.buildPodium(u.index, x, z);
      this.podiums[u.index] = pod;
      this.placeCar(pod, randomModel(), true);
      this.rebuildNav();
      this.refreshTiles();
      this.w.hud.toast(TR.gallery.podiumOpened);
      this.w.onBusinessProgress();
      writeSave(this.w.data);
    }
  }

  // ---------- selling ----------

  joinQueue(b: Buyer) {
    b.state = 'queue';
    b.podium.claimed = true;
    this.queue.push(b);
    b.goTo(this.nav, this.queueSlot(this.queue.length - 1));
  }

  private queueSlot(i: number) { return v(GALLERY.desk[0], GALLERY.desk[1] + 1.2 + i * 0.95); }

  private get sellerHere() { return this.seller !== null; }

  private updateDesk(dt: number, p: THREE.Vector3 | null) {
    const playerAt = !!p && dist2(p, this.sellerZone) < 0.8 * 0.8;
    const b = this.queue[0];
    if (!b || !b.arrived || !(playerAt || this.sellerHere)) {
      this.dealT = 0;
      return;
    }
    this.dealT += dt;
    if (this.dealT < DEALS.close) return;
    this.dealT = 0;
    this.sell(b);
  }

  private sell(b: Buyer) {
    const pod = b.podium;
    this.queue.shift();
    this.queue.forEach((q, i) => q.goTo(this.nav, this.queueSlot(i)));
    b.leave();
    if (!pod.model || !pod.car) return;
    const amount = Math.round(pod.model.price * CAR_MARGIN * this.w.bonusMult());
    this.w.sale(amount);
    this.ss.sold++;
    this.sfx.play('register', 1, 0);
    const at2 = this.toWorld(v(GALLERY.desk[0], GALLERY.desk[1]));
    at2.y = 2.4;
    this.w.floats.spawn(at2, `+${fmtMoney(amount)}`);
    if (this.w.area === this) this.w.hud.toast(TR.gallery.sold(pod.model.name, fmtMoney(amount)));
    // The car drives off the turntable, out of the door and away down the street.
    const car = pod.car;
    (car.userData.label as THREE.Object3D).removeFromParent();
    const from = pod.pos.clone();
    car.removeFromParent();
    car.position.set(from.x, 0, from.z);
    this.root.add(car);
    this.leaving.push({ obj: car, path: [v(from.x * 0.3, 6), v(0, GALLERY.halfD + 1.5), v(-30, GALLERY.street + 4)], t: 0 });
    pod.car = null;
    pod.model = null;
    pod.claimed = false;
    pod.restockT = DEALS.restock;
    this.ss.stock[pod.index] = null;
    // Anyone else eyeing that car gives up on it.
    for (const x of this.buyers) if (x.podium === pod && x !== b && x.state !== 'leaving') {
      this.queue = this.queue.filter((q) => q !== x);
      x.leave();
    }
  }

  private updateLeaving(dt: number) {
    for (const l of this.leaving) {
      const target = l.path[0];
      if (!target) continue;
      const d = target.clone().sub(l.obj.position);
      const dist = d.length();
      const step = dt * 7;
      l.obj.rotation.y = Math.atan2(d.x, d.z);
      if (dist <= step) {
        l.obj.position.copy(target);
        l.path.shift();
      } else l.obj.position.addScaledVector(d.normalize(), step);
    }
    for (const l of this.leaving.filter((x) => !x.path.length)) l.obj.removeFromParent();
    this.leaving = this.leaving.filter((x) => x.path.length);
  }

  private updateStock(dt: number) {
    for (const p of this.podiums) {
      if (!p.open) continue;
      if (p.car) {
        p.car.rotation.y += dt * 0.25;
        continue;
      }
      p.restockT -= dt;
      if (p.restockT <= 0) this.placeCar(p, randomModel(), this.w.area === this);
    }
  }

  // ---------- staff ----------

  deskAt(p: THREE.Vector3) {
    return dist2(p, this.hr.zone) < 0.8 * 0.8 ? 'hr' as const : null;
  }

  /** Standing on the garage ring opens the car shop. */
  atGarage(p: THREE.Vector3) { return dist2(p, this.garageZone) < 0.8 * 0.8; }

  hireCount(id: HireId) { return this.ss.hires[id] ?? 0; }
  lvl(id: UpgradeId) { return this.ss.upg[id] ?? 0; }
  upgradeValue(id: UpgradeId, lvl: number) {
    return id === 'sSpeed' ? BAL.staff.speed + BAL.staff.speedStep * lvl : BAL.staff.cap + BAL.staff.capStep * lvl;
  }

  buyUpgrade(id: UpgradeId) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.lvl(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.max || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    this.ss.upg[id] = lvl + 1;
    this.w.panel.render();
    writeSave(this.w.data);
  }

  hire(id: HireId) {
    const h = GALLERY_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    const cost = hireCost(h, n);
    if (n >= hireMax(h) || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    this.ss.hires[id] = n + 1;
    this.spawnSeller();
    this.sfx.play('unlock', 1, 0);
    this.w.hud.toast(TR.hiredToast(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  fire(id: HireId) {
    if (!this.hireCount(id)) return;
    this.ss.hires[id] = 0;
    this.seller?.root.removeFromParent();
    this.seller = null;
    this.w.hud.toast(TR.firedToast(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  private spawnSeller() {
    if (this.seller) return;
    const c = new Character({ shirt: '#1F2A3A', pants: '#232833', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), collar: '#F4F1EA', tie: C.gold });
    c.root.position.copy(this.sellerZone);
    c.setYaw(0);
    this.root.add(c.root);
    this.seller = c;
  }

  incomePerSecond() { return galleryRate(this.ss); }

  // ---------- frame ----------

  update(dt: number, player: THREE.Vector3, here: boolean) {
    this.time += dt;
    const p = here ? this.toLocal(player) : null;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = DEALS.every * rand(0.7, 1.3) / this.w.events.footfall;
      const cars = this.podiums.filter((x) => x.model && !x.claimed);
      if (cars.length && this.buyers.length < DEALS.maxVisitors) {
        const b = new Buyer(this, cars[Math.floor(Math.random() * cars.length)], v(rand(-12, 12), GALLERY.street + 1));
        this.root.add(b.ch.root);
        this.buyers.push(b);
      }
    }
    for (const b of this.buyers) b.update(dt);
    this.buyers = this.buyers.filter((b) => !b.dead);
    this.updateDesk(dt, p);
    this.updateStock(dt);
    this.updateLeaving(dt);
    const people = [...(p ? [p] : []), ...this.buyers.map((b) => b.pos), ...this.leaving.map((l) => l.obj.position)];
    this.door.update(dt, this.door.sense(people), this.w.reduced);
    if (p) this.updateTiles(dt, p);
  }
}
