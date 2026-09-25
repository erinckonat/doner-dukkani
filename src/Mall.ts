import * as THREE from 'three';
import { BAL, hireCost, hireMax, UPGRADES, upgradeCost, type HireDef, type HireId, type UpgradeId } from './config/balance';
import { MALL, MALL_FLOORS, MALL_HIRES, MALL_OPEN_COST, MALL_ORIGIN, MALL_UNITS, VISITOR, type UnitDef, type UnitKind } from './config/mall';
import { Nav, type Rect } from './core/Nav';
import { writeSave, type SaveData, type ShopState } from './core/Save';
import { dist2 } from './entities/Agent';
import { Character, LOOKS, pick } from './entities/Character';
import { MallStaff, type MallRole } from './entities/MallStaff';
import { MallVisitor, type Step } from './entities/MallVisitor';
import type { Game } from './Game';
import type { Carrier } from './Shop';
import { Door } from './stations/Door';
import { Desk, TrashBin } from './stations/Props';
import { Table, type Seat } from './stations/Table';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { transfer } from './systems/ItemStack';
import { fmtMoney } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { at, box, C, canvasTexture, cyl, floorDecal, makePlant, makeTrash, mat, roundRect } from './world/Assets';
import { plane } from './world/Level';

export type MallState = ShopState & {
  /** Rent waiting in the office safe. */
  rentDue: number;
  /** Rent taken out of the safe, ever (for the goals). */
  collected: number;
  seanses: number;
};

const H = MALL.floorH;
const T = 0.3;
const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const freshMall = (): MallState => ({
  unlocked: MALL_UNITS.filter((u) => u.starter).map((u) => u.id),
  paid: {}, upg: {}, hires: {}, rentDue: 0, collected: 0, seanses: 0,
});

const floorBuilt = (ms: { unlocked: string[] }, f: number) => f === 0 || ms.unlocked.includes(MALL_FLOORS[f - 1].id);

/** Rough TL/second of rent a running mall takes (shops only; the cinema is extra). */
export function mallRate(ms: MallState) {
  const open = MALL_UNITS.filter((u) => ms.unlocked.includes(u.id) && floorBuilt(ms, u.floor) && u.rent > 0);
  if (!open.length) return 0;
  const lvl = (id: UpgradeId) => ms.upg[id] ?? 0;
  const avg = open.reduce((s, u) => s + u.rent, 0) / open.length;
  const perSec = (1 + VISITOR.adsStep * lvl('ads')) / VISITOR.every;
  const stops = Math.min(open.length, (VISITOR.stops[0] + VISITOR.stops[1]) / 2);
  return perSec * stops * avg * (1 + VISITOR.rentStep * lvl('rent')) * 0.6;
}

/** While the game is closed, rent only reaches the account with an accountant on the books. */
export function mallStaffedIncome(data: SaveData) {
  const ms = data.mall;
  return ms && ms.hires.accountant ? mallRate(ms) : 0;
}

export function mallAssets(data: SaveData) {
  const ms = data.mall;
  if (!ms) return 0;
  return MALL_OPEN_COST
    + MALL_UNITS.filter((u) => ms.unlocked.includes(u.id)).reduce((s, u) => s + u.cost, 0)
    + MALL_FLOORS.filter((f) => ms.unlocked.includes(f.id)).reduce((s, f) => s + f.cost, 0);
}

/** Every unlock the mall has: tenants and upper floors (for the progress bar). */
export const MALL_UNLOCK_COUNT = MALL_UNITS.length + MALL_FLOORS.length;

interface Unit {
  def: UnitDef;
  open: boolean;
  group: THREE.Group;
  /** Hoarding across the doorway while it's to let, and its footprint. */
  hoard: THREE.Object3D | null;
  hoardRect: Rect | null;
  door: Door | null;
}

/**
 * Lale Park AVM. Its own local frame (origin MALL_ORIGIN; the street is +z) and a path
 * grid per floor. From outside you see the building (facade and roof); walk in and the
 * shell lifts away to show the floor you're on. Escalators in the middle take you up
 * and down; the tenants pay rent into the office safe with every purchase.
 */
export class Mall {
  readonly id = 'mall' as const;
  def = { hires: MALL_HIRES };
  root = new THREE.Group();
  floors = [0, 1, 2].map(() => new THREE.Group());
  navs = [0, 1, 2].map(() => new Nav(-32, -22, 32, 30));
  rects: Rect[][] = [[], [], []];
  rectsVersion = 0;
  playerFloor = 0;
  units: Unit[] = [];
  visitors: MallVisitor[] = [];
  staff: MallStaff[] = [];
  tables: Table[] = [];
  bin: TrashBin | null = null;
  doors: Door[] = [];

  private ox = MALL_ORIGIN.x;
  private oz = MALL_ORIGIN.z;
  private shell = new THREE.Group();
  private wallRects: Rect[][] = [[], [], []];
  private built = [false, false, false];
  private tiles: UnlockTile[] = [];
  private hr: Desk | null = null;
  private playerLocal = new THREE.Vector3();
  private spawnT = 2;
  private persistT = 0;
  /** The player's escalator ride, and the pad lock that stops a second ride until they step off. */
  private ride: { from: THREE.Vector3; to: THREE.Vector3; dir: 1 | -1; t: number } | null = null;
  private padHold = 0;
  private padLock = false;
  // Rent safe.
  private safeZone = v(MALL.safe[0], MALL.safe[1] - 1.3);
  private safeLabel!: { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; shown: number };
  private collectBuf = 0;
  private collectT = 0;
  private accountantT = 0;
  // Cinema.
  private cinema = { state: 'idle' as 'idle' | 'boarding' | 'showing', t: 0, queue: [] as { v: MallVisitor; since: number }[], watchers: [] as MallVisitor[] };
  private cinemaDoor: Door | null = null;
  private screen: THREE.Mesh | null = null;
  private seansZone = v(-14.6, -4.4);
  private seansHold = 0;
  private time = 0;

  constructor(public w: Game) {
    this.root.position.set(this.ox, 0, this.oz);
    this.floors.forEach((g, f) => {
      g.position.y = f * H;
      g.visible = false;
      this.root.add(g);
    });
    this.root.add(this.shell);
    w.scene.add(this.root);
    this.buildShell();
    for (let f = 0; f < 3; f++) if (floorBuilt(this.ss, f)) this.buildFloor(f);
    for (const h of MALL_HIRES) for (let i = 0; i < this.hireCount(h.id); i++) this.spawnStaff(h);
    this.rebuildNav();
    this.refreshTiles();
    this.updateView(false);
  }

  get ss() { return this.w.data.mall!; }
  get flyer() { return this.w.flyer; }
  get sfx() { return this.w.sfx; }
  private get share() { return this.w.ownerShare('mall'); }

  navFor(floor: number) { return this.navs[floor]; }
  toLocal(p: THREE.Vector3) { return this.playerLocal.set(p.x - this.ox, 0, p.z - this.oz); }
  toWorld(p: THREE.Vector3, floor = 0) { return new THREE.Vector3(p.x + this.ox, p.y + floor * H, p.z + this.oz); }

  worldRects(): Rect[] {
    return this.rects[this.playerFloor].map((r) => ({ x0: r.x0 + this.ox, x1: r.x1 + this.ox, z0: r.z0 + this.oz, z1: r.z1 + this.oz }));
  }

  /** Nothing to persist beyond the save object itself (rent in the safe lives there). */
  persist() {}

  get crowd() { return this.visitors.filter((x) => x.floor === this.playerFloor).length; }

  // ---------- building ----------

  private wall(r: Rect, h: number, color: string, floor: number, blocks = true) {
    const m = box(r.x1 - r.x0, h, r.z1 - r.z0, color);
    m.position.set((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);
    this.floors[floor].add(m);
    this.floors[floor].add(at(box(r.x1 - r.x0 + 0.04, 0.05, r.z1 - r.z0 + 0.04, '#C9A24A', false), m.position.x, h + 0.025, m.position.z));
    if (blocks) this.wallRects[floor].push(r);
    return m;
  }

  /** Seen from the street: a three-storey block with a glass front, a big sign and a roof. */
  private buildShell() {
    const { halfW: W, halfD: D } = MALL;
    const g = this.shell;
    const top = 3 * H;
    const stone = '#E7DFD0';
    g.add(at(box(2 * W + 2 * T, 0.4, 2 * D + 2 * T, '#CFC6B6'), 0, top + 0.2, 0));
    for (const x of [-W - T / 2, W + T / 2]) g.add(at(box(T, top, 2 * D, stone), x, top / 2, 0));
    g.add(at(box(2 * W + 2 * T, top, T, stone), 0, top / 2, -D - T / 2));
    // Front: stone piers and glass bands on each floor, the entrances left open below.
    const fz = D + T / 2;
    for (let f = 0; f < 3; f++) {
      const y = f * H;
      g.add(at(box(2 * W + 2 * T, 0.5, T + 0.02, stone), 0, y + H - 0.25, fz));
      for (let x = -W + 3; x < W - 1; x += 6) {
        const inDoor = f === 0 && MALL.entrances.some((e) => x > e.x0 - 1.2 && x < e.x1 + 1.2);
        if (inDoor) continue;
        g.add(at(box(5.2, H - 0.9, 0.06, '#8FB3C4', false), x, y + (H - 0.5) / 2, fz + 0.05));
        g.add(at(box(0.5, H - 0.5, T + 0.08, stone), x + 3, y + (H - 0.5) / 2, fz));
      }
    }
    // Canopy over the entrances and the sign across the top.
    g.add(at(box(12, 0.16, 2.2, '#2E3A55'), 0, 3.2, D + 1.2));
    const sign = canvasTexture(1024, 160, (ctx) => {
      ctx.fillStyle = '#2E3A55';
      roundRect(ctx, 4, 4, 1016, 152, 30);
      ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.font = '800 104px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.mall.name.toLocaleUpperCase('tr-TR'), 512, 88);
    }).tex;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }));
    signMesh.position.set(0, top - 1.3, fz + 0.2);
    g.add(signMesh);
    // Rooftop plant: a few units, so the roof reads from above.
    for (const [x, z] of [[-18, -10], [-10, -12], [14, -8], [22, -14]] as const) {
      g.add(at(box(3, 1.2, 2, '#B9B2A6'), x, top + 1, z));
      g.add(at(cyl(0.7, 0.7, 0.2, 10, '#8C8579'), x, top + 1.7, z));
    }
    // Glass doors in the entrances belong to the building, so they show from outside too.
    for (const e of MALL.entrances) {
      this.doors.push(new Door(this.root, { x: (e.x0 + e.x1) / 2, z: D + T / 2, width: e.x1 - e.x0, height: 3.0, style: 'slide', color: '#2E3A55' }));
    }
  }

  /** One storey: slab, outer walls, the escalator island, its row of shops, and what's special to it. */
  private buildFloor(f: number) {
    if (this.built[f]) return;
    this.built[f] = true;
    const g = this.floors[f];
    const { halfW: W, halfD: D } = MALL;
    const tiles = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#EFEAE0';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#E4DDCF';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillRect(64, 64, 64, 64);
    }).tex;
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(W, D);
    g.add(at(plane(2 * W, 2 * D, tiles, 0), 0, 0.002, 0));
    // Promenade runner.
    g.add(at(plane(2 * W - 1, 0.12, '#C9A24A', 0), 0, 0.006, MALL.prom.z0 + 0.3));
    g.add(at(plane(2 * W - 1, 0.12, '#C9A24A', 0), 0, 0.006, MALL.prom.z1 - 0.3));

    // Outer walls: tall at the back, low sides; the front is knee-high on the ground floor
    // (with the entrances) and a glass balustrade above.
    this.wall({ x0: -W - T, x1: W + T, z0: -D - T, z1: -D }, 3.2, '#E7DFD0', f).castShadow = false;
    this.wall({ x0: -W - T, x1: -W, z0: -D, z1: D }, 1.4, '#E7DFD0', f);
    this.wall({ x0: W, x1: W + T, z0: -D, z1: D }, 1.4, '#E7DFD0', f);
    if (f === 0) {
      const [a, b] = MALL.entrances;
      this.wall({ x0: -W - T, x1: a.x0, z0: D, z1: D + T }, 0.5, '#E7DFD0', f);
      this.wall({ x0: a.x1, x1: b.x0, z0: D, z1: D + T }, 0.5, '#E7DFD0', f);
      this.wall({ x0: b.x1, x1: W + T, z0: D, z1: D + T }, 0.5, '#E7DFD0', f);
      for (const e of MALL.entrances) g.add(at(plane(e.x1 - e.x0, 1.4, '#2E3A55', 0), (e.x0 + e.x1) / 2, 0.008, D - 0.9));
    } else {
      this.wall({ x0: -W - T, x1: W + T, z0: D, z1: D + T }, 1.0, '#9FC0CF', f);
    }

    // Escalator island: glass railing round the void, a planter, and the pads at either end.
    const I = MALL.island;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(I.x1 - I.x0, 1.0, I.z1 - I.z0), new THREE.MeshStandardMaterial({ color: '#BFD6E0', transparent: true, opacity: 0.35, depthWrite: false }));
    g.add(at(rail, (I.x0 + I.x1) / 2, 0.5, (I.z0 + I.z1) / 2));
    g.add(at(makePlant(), 0, 0, 2));
    this.wallRects[f].push({ x0: I.x0, x1: I.x1, z0: I.z0, z1: I.z1 });
    const label = canvasTexture(256, 96, (ctx) => {
      ctx.fillStyle = C.gold;
      ctx.font = '800 56px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.mall.floorName[f].toLocaleUpperCase('tr-TR'), 128, 52);
    }).tex;
    const floorSign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: label, transparent: true, depthWrite: false }));
    floorSign.rotation.x = -Math.PI / 2;
    floorSign.position.set(0, 0.012, I.z1 + 1.4);
    g.add(floorSign);
    if (f > 0) {
      this.addPad(f, 'down');
      this.buildEscalators(f - 1);
      this.addPad(f - 1, 'up');
    }

    // Shops: the whole row, to let or let.
    for (const def of MALL_UNITS.filter((u) => u.floor === f)) this.buildUnit(def);
    this.buildPartitions(f);

    if (f === 0) this.buildOffice();
    if (f === 1) {
      // Balcony over the entrance hall: benches and planters.
      for (const x of [-4, 4]) {
        g.add(at(box(2.4, 0.45, 0.7, '#8A5A3A'), x, 0.25, 12));
        this.wallRects[1].push({ x0: x - 1.2, x1: x + 1.2, z0: 11.6, z1: 12.4 });
      }
      for (const x of [-5, 0, 5]) g.add(at(makePlant(), x, 0, 16));
      this.wallRects[1].push(...[-5, 0, 5].map((x) => ({ x0: x - 0.3, x1: x + 0.3, z0: 15.7, z1: 16.3 })));
    }
    if (f === 2) this.buildFoodCourt();
  }

  /** The escalators between floor `f` and the one above: an up flight on the left, down on the right. */
  private buildEscalators(f: number) {
    const g = this.floors[f];
    for (const [x, z0, z1] of [[MALL.upPad[0], MALL.upPad[1] - 0.6, MALL.upTop[1] + 0.6], [MALL.downFoot[0], MALL.downFoot[1] - 0.6, MALL.downPad[1] + 0.6]] as const) {
      const len = Math.hypot(z0 - z1, H);
      const flight = new THREE.Group();
      flight.add(at(box(1.1, 0.2, len, '#3A3F4A'), 0, 0, 0));
      for (const s of [-0.6, 0.6]) flight.add(at(box(0.06, 0.9, len, '#BFD6E0', false), s, 0.5, 0));
      for (let i = 0; i < 10; i++) flight.add(at(box(1.0, 0.03, 0.08, C.steel, false), 0, 0.11, -len / 2 + (i + 0.5) * (len / 10)));
      flight.position.set(x, H / 2, (z0 + z1) / 2);
      flight.rotation.x = Math.atan2(H, z0 - z1);
      g.add(flight);
    }
  }

  private padDecals: THREE.Object3D[] = [];

  /** Floor ring at the foot of an escalator: stand on it to ride. */
  private addPad(f: number, dir: 'up' | 'down') {
    const [x, z] = dir === 'up' ? MALL.upPad : MALL.downPad;
    const { tex } = canvasTexture(256, 256, (ctx) => {
      ctx.beginPath();
      ctx.arc(128, 128, 112, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,250,240,0.7)';
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#2E3A55';
      ctx.stroke();
      ctx.strokeStyle = '#2E3A55';
      ctx.lineWidth = 18;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const s = dir === 'up' ? -1 : 1;
      ctx.moveTo(80, 128 - s * 20); ctx.lineTo(128, 128 + s * 30); ctx.lineTo(176, 128 - s * 20);
      ctx.stroke();
      ctx.fillStyle = '#2E3A55';
      ctx.font = '800 36px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(dir === 'up' ? TR.mall.up : TR.mall.down, 128, dir === 'up' ? 200 : 76);
    });
    const d = floorDecal(tex, 1.3);
    d.position.set(x, 0.02, z);
    this.floors[f].add(d);
    this.padDecals.push(d);
  }

  /** Side walls between neighbouring shops (and around the office), per row. */
  private buildPartitions(f: number) {
    for (const row of ['n', 's'] as const) {
      const xs = new Set<number>();
      for (const u of MALL_UNITS.filter((x) => x.floor === f && x.row === row)) { xs.add(u.x0); xs.add(u.x1); }
      if (f === 0 && row === 's') { xs.add(MALL.office.x0); xs.add(MALL.office.x1); }
      const [z0, z1] = row === 'n' ? [-MALL.halfD, MALL.prom.z0] : [MALL.prom.z1, MALL.halfD];
      for (const x of xs) {
        if (Math.abs(x) >= MALL.halfW) continue;
        this.wall({ x0: x - 0.08, x1: x + 0.08, z0, z1 }, 1.4, '#E2DACB', f);
      }
    }
  }

  /** Where a shop's doorway is, and the spots just outside and just inside it. */
  private front(d: UnitDef) {
    const cx = (d.x0 + d.x1) / 2;
    const n = d.row === 'n';
    const z = n ? MALL.prom.z0 : MALL.prom.z1;
    const s = n ? 1 : -1; // towards the promenade
    return { cx, z, out: v(cx, z + s * 1.3), in: v(cx, z - s * 1.4), s };
  }

  /** A shop unit's shell: its floor, its shopfront with a doorway, and hoarding while it's to let. */
  private buildUnit(def: UnitDef) {
    const g = new THREE.Group();
    this.floors[def.floor].add(g);
    const f = def.floor;
    const { cx, z, s } = this.front(def);
    const back = def.row === 'n' ? -MALL.halfD : MALL.halfD;
    const unit: Unit = { def, open: false, group: g, hoard: null, hoardRect: null, door: null };
    this.units.push(unit);
    const gap = def.kind === 'cinema' ? 3 : 2.6;
    if (def.kind === 'food') {
      // A stand: a short kitchen behind an open counter, no shopfront.
      this.wall({ x0: def.x0, x1: def.x1, z0: -10.1, z1: -9.9 }, 2.2, '#E2DACB', f);
    } else {
      // Low shopfronts, like every wall inside, so you can see into the shops.
      const h = 1.2;
      this.wall({ x0: def.x0, x1: cx - gap / 2, z0: z - 0.08, z1: z + 0.08 }, h, '#DCD4C5', f);
      this.wall({ x0: cx + gap / 2, x1: def.x1, z0: z - 0.08, z1: z + 0.08 }, h, '#DCD4C5', f);
    }
    // Bare concrete until a tenant moves in.
    const depth = Math.abs(back - z);
    const floor = at(plane(def.x1 - def.x0 - 0.2, depth - 0.2, '#C9C1B4', 0), cx, 0.004, (z + back) / 2);
    g.add(floor);
    if (this.ss.unlocked.includes(def.id)) this.openUnit(unit, false);
    else {
      const w = def.kind === 'food' ? def.x1 - def.x0 - 0.4 : gap;
      const hz = def.kind === 'food' ? -6.2 : z;
      unit.hoard = at(box(w, 1.2, 0.12, '#8C8579'), cx, 0.6, hz);
      g.add(unit.hoard);
      unit.hoardRect = { x0: cx - w / 2, x1: cx + w / 2, z0: hz - 0.1, z1: hz + 0.1 };
      const sign = this.brandMat(TR.mall.toLet, '', '#8C8579', C.cream);
      sign.position.set(cx, 0.012, z + s * 2.2);
      g.add(sign);
      unit.hoard.userData.sign = sign;
    }
  }

  /** Brand name as a mat on the floor, readable from above whichever way the shop faces. */
  private brandMat(name: string, tag: string, bg: string, fg: string) {
    const tex = canvasTexture(768, 256, (ctx) => {
      ctx.fillStyle = bg;
      roundRect(ctx, 6, 6, 756, 244, 44);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 104;
      do ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
      while (ctx.measureText(name).width > 700 && (size -= 6) > 40);
      ctx.fillText(name, 384, tag ? 108 : 132);
      if (tag) {
        ctx.font = '700 40px "Nunito", sans-serif';
        ctx.globalAlpha = 0.85;
        ctx.fillText(tag, 384, 196);
      }
    }).tex;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  /** A tenant moves in: hoarding down, doors in, shop fitted, sign up, someone at the till. */
  private openUnit(unit: Unit, animate: boolean) {
    const d = unit.def;
    const g = unit.group;
    unit.open = true;
    if (unit.hoard) {
      (unit.hoard.userData.sign as THREE.Object3D | undefined)?.removeFromParent();
      unit.hoard.removeFromParent();
      unit.hoard = null;
      unit.hoardRect = null;
    }
    const { cx, z, s } = this.front(d);
    const back = d.row === 'n' ? -MALL.halfD : MALL.halfD;
    // Tinted floor in the brand's colour.
    g.add(at(plane(d.x1 - d.x0 - 0.2, Math.abs(back - z) - 0.2, tint(d.color), 0), cx, 0.005, (z + back) / 2));
    const mat2 = this.brandMat(d.brand, d.tag, d.color, d.accent);
    mat2.position.set(cx, 0.014, z - s * 2.4);
    g.add(mat2);
    if (d.row === 'n' && d.kind !== 'food') {
      // Fascia over the shopfront, facing the promenade.
      const fascia = canvasTexture(768, 128, (ctx) => {
        ctx.fillStyle = d.color;
        ctx.fillRect(0, 0, 768, 128);
        ctx.fillStyle = d.accent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let size = 84;
        do ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
        while (ctx.measureText(d.brand).width > 720 && (size -= 6) > 36);
        ctx.fillText(d.brand, 384, 70);
      }).tex;
      const fm = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(8, d.x1 - d.x0 - 0.8), 0.75), new THREE.MeshStandardMaterial({ map: fascia, roughness: 0.8 }));
      fm.position.set(cx, 1.62, z + 0.12);
      g.add(fm);
    }
    if (d.kind === 'food') this.fitStand(unit);
    else if (d.kind === 'cinema') this.fitCinema(unit);
    else {
      unit.door = new Door(g, { x: cx, z, width: 2.6, height: 2.1, style: 'slide', color: d.color, floor: d.floor });
      this.doors.push(unit.door);
      this.fitShop(unit);
    }
    if (!animate) return;
    this.rebuildNav();
    this.w.celebrate(g, this.toWorld(v(cx, z), d.floor));
    this.w.hud.toast(TR.mall.unitOpened(d.brand));
  }

  /** Map shop-local (across, depth from the shopfront) to mall coordinates. */
  private inUnit(d: UnitDef, across: number, depth: number) {
    const { cx, z, s } = this.front(d);
    return v(cx + across, z - s * depth);
  }

  /** Shop fittings by kind, a till with someone behind it, and the obstacles they make. */
  private fitShop(unit: Unit) {
    const d = unit.def;
    const g = unit.group;
    const f = d.floor;
    const half = (d.x1 - d.x0) / 2;
    const put = (o: THREE.Object3D, across: number, depth: number, w: number, dd: number) => {
      const p = this.inUnit(d, across, depth);
      o.position.set(p.x, 0, p.z);
      g.add(o);
      this.wallRects[f].push({ x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - dd / 2, z1: p.z + dd / 2 });
    };
    const colours = [d.color, d.accent, '#E3A64A', '#3E6B5A', '#C8412B', '#E9E4DA', '#2F5D8C'];
    const lanes = half > 5 ? [-half + 2.4, 0, half - 2.4] : [-half + 2, half - 2];
    for (const [i, across] of lanes.entries()) {
      for (const depth of [7, 10.5]) put(fitting(d.kind, colours, i), across, depth, 2.2, 1.0);
    }
    // Till near the back corner, with the shop assistant.
    const till = new THREE.Group();
    till.add(at(box(1.8, 1.0, 0.7, d.color), 0, 0.5, 0));
    till.add(at(box(1.84, 0.06, 0.74, '#F4EAD8', false), 0, 1.03, 0));
    till.add(at(box(0.4, 0.3, 0.3, C.dark), 0.4, 1.2, 0));
    put(till, -half + 2, 13, 1.8, 0.7);
    const clerk = new Character({ shirt: d.color, pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), apron: d.accent });
    const cp = this.inUnit(d, -half + 2, 14);
    clerk.root.position.set(cp.x, 0, cp.z);
    clerk.setYaw(d.row === 'n' ? 0 : Math.PI);
    g.add(clerk.root);
    // A mannequin in the window.
    const man = new THREE.Group();
    man.add(at(cyl(0.2, 0.16, 0.9, 8, d.color), 0, 0.95, 0));
    man.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat('#E9E4DA')), 0, 1.55, 0));
    man.add(at(cyl(0.05, 0.05, 0.5, 6, C.steel), 0, 0.25, 0));
    put(man, half - 1.1, 1.2, 0.5, 0.5);
  }

  /** Food stand: counter across the front, a menu board, a cook. */
  private fitStand(unit: Unit) {
    const d = unit.def;
    const g = unit.group;
    const cx = (d.x0 + d.x1) / 2;
    const w = d.x1 - d.x0 - 0.8;
    g.add(at(box(w, 1.05, 0.7, d.color), cx, 0.52, -6.6));
    g.add(at(box(w + 0.06, 0.06, 0.76, '#F4EAD8', false), cx, 1.07, -6.6));
    this.wallRects[2].push({ x0: cx - w / 2, x1: cx + w / 2, z0: -6.95, z1: -6.25 });
    const board = canvasTexture(512, 192, (ctx) => {
      ctx.fillStyle = d.color;
      ctx.fillRect(0, 0, 512, 192);
      ctx.fillStyle = d.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 64;
      do ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
      while (ctx.measureText(d.brand).width > 480 && (size -= 4) > 28);
      ctx.fillText(d.brand, 256, 70);
      ctx.font = '700 30px "Nunito", sans-serif';
      ctx.fillText(d.tag, 256, 140);
    }).tex;
    const bm = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.1), new THREE.MeshStandardMaterial({ map: board, roughness: 0.8 }));
    bm.position.set(cx, 2.6, -9.85);
    g.add(bm);
    const cook = new Character({ shirt: '#FFFAF0', pants: C.dark, skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), hat: 'chef', apron: d.color });
    cook.root.position.set(cx, 0, -8);
    g.add(cook.root);
  }

  /** The cinema: rows of red seats before the screen, double doors that close for the film. */
  private fitCinema(unit: Unit) {
    const d = unit.def;
    const g = unit.group;
    const { cx, z } = this.front(d);
    for (let i = 0; i < MALL.cinemaSeats; i++) {
      const p = this.seatPos(i);
      const seat = new THREE.Group();
      seat.add(at(box(0.6, 0.45, 0.55, '#8E2A22'), 0, 0.23, 0));
      seat.add(at(box(0.6, 0.6, 0.12, '#A8322A'), 0, 0.7, 0.26));
      seat.position.set(p.x, 0, p.z);
      g.add(seat);
    }
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(18, 5), new THREE.MeshStandardMaterial({ color: '#3A3F4A', emissive: '#FFFAF0', emissiveIntensity: 0 }));
    this.screen.position.set((d.x0 + d.x1) / 2, 2.7, -MALL.halfD + 0.12);
    g.add(this.screen);
    this.cinemaDoor = new Door(g, { x: cx, z, width: 3, height: 2.4, style: 'swing', double: true, into: -1, color: '#6B2E2E', floor: 2 });
    this.doors.push(this.cinemaDoor);
    // Where the usher (or you) starts the showing.
    const { tex } = canvasTexture(256, 256, (ctx) => {
      ctx.beginPath();
      ctx.arc(128, 128, 112, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,250,240,0.7)';
      ctx.fill();
      ctx.setLineDash([26, 16]);
      ctx.lineWidth = 10;
      ctx.strokeStyle = C.primary;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.dark;
      roundRect(ctx, 70, 84, 116, 76, 10);
      ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.moveTo(116, 100); ctx.lineTo(150, 122); ctx.lineTo(116, 144);
      ctx.fill();
      ctx.fillStyle = C.dark;
      ctx.font = '800 38px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(TR.mall.seans, 128, 204);
    });
    const pad = floorDecal(tex, 1.4);
    pad.position.set(this.seansZone.x, 0.02, this.seansZone.z);
    g.add(pad);
  }

  private seatPos(i: number) {
    const row = Math.floor(i / 12);
    return v(-26.5 + (i % 12) * 1.5, -11 - row * 1.7);
  }

  /** Management office on the ground floor: walls, a door, the HR desk and the rent safe. */
  private buildOffice() {
    const O = MALL.office;
    const g = this.floors[0];
    this.wall({ x0: O.x0, x1: O.doorX0, z0: O.z0 - 0.08, z1: O.z0 + 0.08 }, 1.4, '#E2DACB', 0);
    this.wall({ x0: O.doorX1, x1: O.x1, z0: O.z0 - 0.08, z1: O.z0 + 0.08 }, 1.4, '#E2DACB', 0);
    this.doors.push(new Door(g, { x: (O.doorX0 + O.doorX1) / 2, z: O.z0, width: O.doorX1 - O.doorX0 - 0.1, height: 1.4, style: 'swing', into: 1, color: '#7A4E34' }));
    g.add(at(plane(O.x1 - O.x0 - 0.2, O.z1 - O.z0 - 0.2, '#8E3B2E', 0), (O.x0 + O.x1) / 2, 0.006, (O.z0 + O.z1) / 2));
    const office = this.brandMat(TR.mall.office, '', '#2E3A55', C.gold);
    office.position.set((O.doorX0 + O.doorX1) / 2, 0.014, O.z0 - 1.5);
    g.add(office);
    this.hr = new Desk(MALL.desk, g, 'hr');
    // The safe, with the rent in it shown above.
    const [sx, sz] = MALL.safe;
    const safe = new THREE.Group();
    safe.add(at(box(1.0, 1.2, 0.8, '#3A3F4A'), 0, 0.6, 0));
    safe.add(at(cyl(0.16, 0.16, 0.06, 12, C.gold), 0, 0.7, -0.42));
    safe.children[1].rotation.x = Math.PI / 2;
    safe.position.set(sx, 0, sz);
    g.add(safe);
    this.wallRects[0].push({ x0: sx - 0.5, x1: sx + 0.5, z0: sz - 0.4, z1: sz + 0.4 });
    const ring = canvasTexture(256, 256, (ctx) => {
      ctx.beginPath();
      ctx.arc(128, 128, 112, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,250,240,0.7)';
      ctx.fill();
      ctx.setLineDash([26, 16]);
      ctx.lineWidth = 10;
      ctx.strokeStyle = C.gold;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.dark;
      ctx.font = '800 60px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.mall.rent, 128, 132);
    }).tex;
    const rd = floorDecal(ring, 1.4);
    rd.position.set(this.safeZone.x, 0.02, this.safeZone.z);
    g.add(rd);
    const { tex, ctx } = canvasTexture(512, 128, () => {});
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sprite.scale.set(3.2, 0.8, 1);
    sprite.position.set(sx, 2.1, sz);
    sprite.renderOrder = 10;
    g.add(sprite);
    this.safeLabel = { sprite, ctx, tex, shown: -1 };
    this.drawSafe();
  }

  private drawSafe() {
    const L = this.safeLabel;
    const amount = Math.floor(this.ss.rentDue);
    if (amount === L.shown) return;
    L.shown = amount;
    const ctx = L.ctx;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = '#2E3A55';
    roundRect(ctx, 8, 12, 496, 104, 40);
    ctx.fill();
    ctx.fillStyle = C.gold;
    ctx.font = '800 60px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtMoney(amount), 256, 68);
    L.tex.needsUpdate = true;
  }

  /** The top floor's food court: tables in rows south of the stands, and a bin. */
  private buildFoodCourt() {
    const g = this.floors[2];
    for (const [x, z] of MALL.tables) {
      const t = new Table(x, z, g, this.flyer, '#C8412B', '#9E2F1E');
      this.tables.push(t);
      this.wallRects[2].push(t.rect);
    }
    this.bin = new TrashBin(MALL.bin, g);
    this.wallRects[2].push(this.bin.rect);
    const sign = this.brandMat(TR.mall.foodCourt, '', '#C8412B', C.cream);
    sign.position.set(13, 0.014, 19.4);
    g.add(sign);
    // Benches in the cinema lobby.
    for (const x of [-26, -20, -14]) {
      g.add(at(box(2.4, 0.45, 0.7, '#8A5A3A'), x, 0.25, 14));
      this.wallRects[2].push({ x0: x - 1.2, x1: x + 1.2, z0: 13.6, z1: 14.4 });
    }
  }

  private rebuildNav() {
    this.rects = [0, 1, 2].map((f) => [
      ...this.wallRects[f],
      ...this.units.filter((u) => u.def.floor === f && u.hoardRect).map((u) => u.hoardRect!),
      ...(f === 0 && this.hr ? this.hr.rects : []),
    ]);
    this.navs.forEach((n, f) => n.rebuild(this.rects[f]));
    this.rectsVersion++;
  }

  // ---------- unlocks ----------

  /** Two shops at a time on each built floor, and the next floor at the foot of the up escalator. */
  private refreshTiles() {
    const wanted: { id: string; floor: number; cost: number; x: number; z: number; label: string }[] = [];
    for (let f = 0; f < 3; f++) {
      if (!this.built[f]) continue;
      for (const d of MALL_UNITS.filter((u) => u.floor === f && !this.ss.unlocked.includes(u.id)).slice(0, 2)) {
        const { cx, z, s } = this.front(d);
        wanted.push({ id: d.id, floor: f, cost: d.cost, x: cx, z: d.kind === 'food' ? -4.6 : z + s * 1.5, label: d.brand });
      }
      const next = MALL_FLOORS[f];
      if (next && !this.built[f + 1]) wanted.push({ id: next.id, floor: f, cost: next.cost, x: MALL.upPad[0], z: MALL.upPad[1], label: TR.mall.floorName[f + 1] });
    }
    this.tiles = this.tiles.filter((t) => {
      if (wanted.some((w) => w.id === t.def.id)) return true;
      t.dispose();
      return false;
    });
    for (const w of wanted) {
      if (this.tiles.some((t) => t.def.id === w.id)) continue;
      const def: TileDef = { id: w.id, cost: w.cost, x: w.x, z: w.z, label: w.label };
      const tile = new UnlockTile(def, this.ss.paid[w.id] ?? 0, this.floors[w.floor]);
      tile.mesh.userData.floor = w.floor;
      this.tiles.push(tile);
    }
  }

  private updateTiles(dt: number, p: THREE.Vector3) {
    for (const tile of [...this.tiles]) {
      tile.update(this.w.reduced ? 0 : this.w.time);
      const on = tile.mesh.userData.floor === this.playerFloor && !this.ride && dist2(p, tile.pos) < 0.95 * 0.95;
      if (!this.w.payTile(tile, on, dt, this.ss.paid)) continue;
      const id = tile.def.id;
      delete this.ss.paid[id];
      tile.dispose();
      this.tiles = this.tiles.filter((t) => t !== tile);
      this.ss.unlocked.push(id);
      const floor = MALL_FLOORS.find((x) => x.id === id);
      if (floor) {
        this.buildFloor(floor.floor);
        this.padLock = true; // bought standing on the pad: step off and back on to ride
        this.w.celebrate(new THREE.Object3D(), this.toWorld(v(MALL.upPad[0], MALL.upPad[1]), floor.floor - 1));
        this.w.hud.toast(TR.mall.floorOpened(TR.mall.floorName[floor.floor]));
      } else {
        this.openUnit(this.units.find((u) => u.def.id === id)!, true);
      }
      this.rebuildNav();
      this.refreshTiles();
      this.w.onBusinessProgress();
      writeSave(this.w.data);
    }
  }

  // ---------- visitors ----------

  private get visitorMax() { return this.upgradeValue('parking', this.lvl('parking')); }

  private openShops() {
    return this.units.filter((u) => u.open && this.built[u.def.floor]);
  }

  /** Walk from floor `a` to floor `b` by escalator (steps appended to `out`). */
  private travel(out: Step[], a: number, b: number) {
    while (a < b) { out.push(v(MALL.upPad[0], MALL.upPad[1]), { ride: 1 }); a++; }
    while (a > b) { out.push(v(MALL.downPad[0], MALL.downPad[1]), { ride: -1 }); a--; }
    return b;
  }

  /** A visit, planned on arrival: a few shops (lowest floor first), maybe lunch or a film, then home. */
  private plan(entrance: { x0: number; x1: number }): Step[] {
    const ex = (entrance.x0 + entrance.x1) / 2;
    const steps: Step[] = [v(ex, MALL.halfD + 1.4), v(ex, MALL.halfD - 1.6)];
    const open = this.openShops();
    const shops = shuffle(open.filter((u) => u.def.kind !== 'food' && u.def.kind !== 'cinema'));
    const n = Math.min(shops.length, Math.round(rand(VISITOR.stops[0], VISITOR.stops[1])));
    const pickShops = shops.slice(0, n).sort((a, b) => a.def.floor - b.def.floor);
    let floor = 0;
    for (const u of pickShops) {
      floor = this.travel(steps, floor, u.def.floor);
      const fr = this.front(u.def);
      const half = (u.def.x1 - u.def.x0) / 2;
      const browse = this.inUnit(u.def, rand(-half + 1.2, half - 1.2), rand(3, 4.8));
      steps.push(fr.out, fr.in, browse, { wait: rand(2.5, 5) }, { buy: u.def }, fr.in, fr.out);
    }
    const stands = open.filter((u) => u.def.kind === 'food');
    if (stands.length && Math.random() < 0.5) {
      const u = stands[Math.floor(Math.random() * stands.length)];
      floor = this.travel(steps, floor, 2);
      const cx = (u.def.x0 + u.def.x1) / 2;
      steps.push(v(cx + rand(-1, 1), -5.4), { wait: rand(1.5, 2.5) }, { buy: u.def }, { eat: true });
    }
    if (open.some((u) => u.def.kind === 'cinema') && Math.random() < 0.35) {
      floor = this.travel(steps, floor, 2);
      steps.push(v(-22, -3.2), { cinema: true });
    }
    this.travel(steps, floor, 0);
    const side = Math.random() < 0.5 ? -1 : 1;
    steps.push(v(ex, MALL.halfD - 1.6), v(ex, MALL.halfD + 1.4), v(ex + side * rand(8, 20), MALL.street));
    return steps;
  }

  private spawnVisitor() {
    const e = MALL.entrances[Math.floor(Math.random() * MALL.entrances.length)];
    const from = v((Math.random() < 0.5 ? -1 : 1) * rand(10, 24), MALL.street);
    const vis = new MallVisitor(this, this.plan(e), from);
    this.root.add(vis.ch.root);
    this.visitors.push(vis);
  }

  /** From where a flight starts on `floor` to where it lets off on the next floor, in mall coordinates. */
  escalatorPath(floor: number, dir: 1 | -1) {
    const [a, b] = dir === 1 ? [MALL.upPad, MALL.upTop] : [MALL.downPad, MALL.downFoot];
    return {
      from: new THREE.Vector3(a[0], floor * H, a[1]),
      to: new THREE.Vector3(b[0], (floor + dir) * H, b[1]),
    };
  }

  /** A sale in a shop or at a stand: turnover rent into the safe. */
  purchase(vis: MallVisitor, d: UnitDef) {
    const amount = Math.round(d.rent * this.upgradeValue('rent', this.lvl('rent')) * this.w.bonusMult());
    if (!amount) return;
    this.ss.rentDue += amount;
    const st = this.w.data.stats;
    if (st) st.served++;
    if (vis.floor === this.playerFloor && this.w.area === this) {
      const p = this.toWorld(vis.pos.clone());
      p.y = vis.floor * H + 2.3;
      this.w.floats.spawn(p, `+${fmtMoney(amount)}`);
    }
  }

  findSeat(): Seat | null {
    const free: Seat[] = [];
    for (const t of this.tables) {
      if (t.dirty) continue;
      for (const s of t.seats) if (!s.occupant) free.push(s);
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  /** Lunch over: the tray and wrappers stay on the table. */
  leaveTray(seat: Seat) {
    const from = new THREE.Vector3();
    seat.plate.anchor.getWorldPosition(from);
    for (let i = 0; i < 2; i++) {
      const t = makeTrash();
      t.position.copy(from);
      this.w.scene.add(t);
      seat.table.trash.receive(t, 'trash', 0.25 + i * 0.05);
    }
  }

  // ---------- cinema ----------

  private queueSlot(i: number) { return v(-28 + (i % 8) * 1.2, -4.8 + Math.floor(i / 8) * 1.2); }

  /** Join the queue for the next showing; false if it's full (they skip the film). */
  joinCinema(vis: MallVisitor) {
    const c = this.cinema;
    if (!this.cinemaDoor || c.queue.length >= MALL.cinemaSeats) return false;
    vis.atCinema = true;
    c.queue.push({ v: vis, since: this.time });
    vis.walkTo(this.queueSlot(c.queue.length - 1));
    return true;
  }

  get cinemaQueue() { return this.cinema.queue.length; }

  /** Doors open, the queue files in and pays; the film starts once they're seated. */
  startShow() {
    const c = this.cinema;
    if (c.state !== 'idle' || !c.queue.length) return;
    const n = c.queue.length;
    const amount = Math.round(n * MALL.ticket * this.w.bonusMult() * this.share);
    this.w.sale(amount, false);
    this.ss.seanses++;
    c.watchers = c.queue.map((q) => q.v);
    c.queue = [];
    c.watchers.forEach((w, i) => w.walkTo(this.seatPos(i)));
    c.state = 'boarding';
    c.t = 0;
    this.sfx.play('fanfare', 1, 0);
    if (this.w.area === this) this.w.hud.toast(TR.mall.seansStarted(n, fmtMoney(amount)));
  }

  private updateCinema(dt: number, p: THREE.Vector3 | null) {
    const c = this.cinema;
    if (!this.cinemaDoor) return;
    c.t += dt;
    // Anyone who's queued for too long gives up.
    const bored = c.queue.filter((q) => this.time - q.since > 90);
    if (bored.length) {
      c.queue = c.queue.filter((q) => !bored.includes(q));
      for (const q of bored) q.v.leaveCinema(true);
      c.queue.forEach((q, i) => q.v.walkTo(this.queueSlot(i)));
    }
    if (c.state === 'boarding') {
      for (const w of c.watchers) {
        if (w.arrived && !w.ch.sitting) {
          w.ch.sitting = true;
          w.ch.setYaw(Math.PI);
        }
      }
      if (c.watchers.every((w) => w.ch.sitting) || c.t > 14) {
        c.state = 'showing';
        c.t = 0;
      }
    } else if (c.state === 'showing') {
      if (c.t > MALL.filmSecs) {
        c.state = 'idle';
        for (const w of c.watchers) {
          w.ch.sitting = false;
          w.leaveCinema();
        }
        c.watchers = [];
      }
    }
    const lit = c.state === 'showing' ? 0.9 + Math.sin(this.time * 3) * 0.08 : 0;
    (this.screen!.material as THREE.MeshStandardMaterial).emissiveIntensity = lit;
    // Standing on the SEANS ring (or the usher at it) starts the showing.
    const here = !!p && this.playerFloor === 2 && dist2(p, this.seansZone) < 0.8 * 0.8;
    this.seansHold = here ? this.seansHold + dt : 0;
    if (this.seansHold > 0.5) {
      this.seansHold = -2;
      if (c.state !== 'idle') this.w.hud.toast(TR.mall.seansBusy);
      else if (!c.queue.length) this.w.hud.toast(TR.mall.seansEmpty);
      else this.startShow();
    }
    const usher = this.staff.find((s) => s.role === 'usher' && s.atPost);
    const oldest = c.queue[0] ? this.time - c.queue[0].since : 0;
    if (usher && c.state === 'idle' && c.queue.length && (c.queue.length >= MALL.cinemaSeats * 0.6 || oldest > 25)) this.startShow();
  }

  // ---------- rent ----------

  /** Standing at the safe empties it into the account (the owner's share of it). */
  private updateSafe(dt: number, p: THREE.Vector3 | null) {
    if (!this.safeLabel) return;
    const ms = this.ss;
    const atSafe = !!p && this.playerFloor === 0 && dist2(p, this.safeZone) < 0.9 * 0.9;
    if (atSafe && ms.rentDue >= 1) {
      const take = Math.min(ms.rentDue, Math.max(ms.rentDue, 5000) * dt * 1.6);
      this.collect(take);
      this.sfx.play('tick', 1.4, 60);
    }
    this.accountantT -= dt;
    const acc = this.staff.find((s) => s.role === 'accountant' && s.atPost);
    if (acc && this.accountantT <= 0 && ms.rentDue >= 1) {
      this.accountantT = 3;
      this.collect(ms.rentDue);
    }
    this.collectT -= dt;
    if (this.collectBuf >= 1 && (this.collectT <= 0 || ms.rentDue < 1)) {
      this.collectT = 0.35;
      if (this.w.area === this && this.playerFloor === 0) {
        const at2 = this.toWorld(v(MALL.safe[0], MALL.safe[1]));
        at2.y = 2.9;
        this.w.floats.spawn(at2, `+${fmtMoney(this.collectBuf)}`);
      }
      this.collectBuf = 0;
    }
    this.drawSafe();
  }

  private collect(amount: number) {
    const ms = this.ss;
    ms.rentDue -= amount;
    if (ms.rentDue < 0.5) ms.rentDue = 0;
    ms.collected += amount;
    const mine = amount * this.share;
    this.w.sale(mine, false);
    this.collectBuf += mine;
  }

  incomePerSecond() { return mallRate(this.ss); }

  // ---------- desks, staff and upgrades ----------

  deskAt(p: THREE.Vector3) {
    return this.hr && this.playerFloor === 0 && dist2(p, this.hr.zone) < 0.8 * 0.8 ? 'hr' as const : null;
  }

  hireCount(id: HireId) { return this.ss.hires[id] ?? 0; }
  lvl(id: UpgradeId) { return this.ss.upg[id] ?? 0; }

  upgradeValue(id: UpgradeId, lvl: number) {
    switch (id) {
      case 'sSpeed': return BAL.staff.speed + BAL.staff.speedStep * lvl;
      case 'sCap': return BAL.staff.cap + BAL.staff.capStep * lvl;
      case 'ads': return 1 + VISITOR.adsStep * lvl;
      case 'parking': return VISITOR.max + VISITOR.parkingStep * lvl;
      case 'rent': return 1 + VISITOR.rentStep * lvl;
      default: return 0;
    }
  }

  get staffSpeed() { return this.upgradeValue('sSpeed', this.lvl('sSpeed')); }
  get staffCap() { return this.upgradeValue('sCap', this.lvl('sCap')); }

  buyUpgrade(id: UpgradeId) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.lvl(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.max || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    this.ss.upg[id] = lvl + 1;
    this.sfx.play('register', 1, 0);
    this.w.panel.render();
    writeSave(this.w.data);
  }

  hire(id: HireId) {
    const h = MALL_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    const cost = hireCost(h, n);
    if (n >= hireMax(h) || this.w.data.money < cost) return;
    if (h.requires && !this.ss.unlocked.includes(h.requires)) return;
    this.w.data.money -= cost;
    this.ss.hires[id] = n + 1;
    this.spawnStaff(h);
    this.sfx.play('unlock', 1, 0);
    this.w.hud.toast(TR.hiredToast(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  fire(id: HireId) {
    const h = MALL_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    if (!n) return;
    const s = this.staff.filter((x) => x.role === (h.role as MallRole) && !x.leaving).pop();
    if (!s) return;
    s.dismiss();
    this.ss.hires[id] = n - 1;
    this.w.hud.toast(TR.firedToast(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  private spawnStaff(h: HireDef) {
    const role = h.role as MallRole;
    const i = this.staff.filter((s) => s.role === role).length;
    const home = role === 'accountant' ? this.safeZone.clone()
      : role === 'usher' ? this.seansZone.clone()
      : v(26 - (i % 3) * 1.2, 19.5 - Math.floor(i / 3) * 1.1);
    const s = new MallStaff(role, home, this);
    this.staff.push(s);
    this.root.add(s.ch.root);
  }

  /** Clearing the food court: pick up trays from tables, drop them in the bin. */
  interact(c: Carrier | MallStaff, p: THREE.Vector3, floor = this.playerFloor) {
    if (floor !== 2 || c.cd > 0 || !this.bin) return;
    const st = c.stack;
    if (st.canAccept('trash') && (c.wants === undefined || c.wants === 'trash' || c.isPlayer)) {
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

  // ---------- frame ----------

  /** Standing on an escalator pad rides it; the camera follows the player up or down. */
  private updateEscalator(dt: number, p: THREE.Vector3 | null) {
    const player = this.w.player;
    if (this.ride) {
      const r = this.ride;
      r.t = Math.min(1, r.t + dt / 1.6);
      const local = new THREE.Vector3().lerpVectors(r.from, r.to, r.t);
      player.pos.set(local.x + this.ox, local.y, local.z + this.oz);
      player.ch.face(r.to.x - r.from.x, r.to.z - r.from.z, dt * 10);
      if (r.t < 1) return;
      this.playerFloor += r.dir;
      this.ride = null;
      this.padLock = false;
      this.rectsVersion++;
      this.w.hud.toast(TR.mall.floorName[this.playerFloor]);
      return;
    }
    if (!p) return;
    const f = this.playerFloor;
    const onUp = f < 2 && this.built[f + 1] && dist2(p, v(MALL.upPad[0], MALL.upPad[1])) < 0.7 * 0.7;
    const onDown = f > 0 && dist2(p, v(MALL.downPad[0], MALL.downPad[1])) < 0.7 * 0.7;
    if (!onUp && !onDown) {
      this.padHold = 0;
      this.padLock = false;
      return;
    }
    if (this.padLock) return;
    this.padHold += dt;
    if (this.padHold < 0.35) return;
    this.padLock = true;
    const dir = onUp ? 1 : -1;
    const path = this.escalatorPath(f, dir);
    this.ride = { ...path, dir, t: 0 };
    this.sfx.play('tick', 0.8, 0);
  }

  /** Inside, only the player's floor is drawn; from outside, the building. */
  private updateView(here: boolean) {
    const view = here ? this.playerFloor : -1;
    this.shell.visible = !here;
    this.floors.forEach((g, f) => { g.visible = f === view; });
    for (const a of [...this.visitors, ...this.staff]) {
      a.ch.root.visible = here ? a.floor === view : a.floor === 0 && a.pos.z > MALL.halfD;
    }
  }

  private updateDoors(dt: number, p: THREE.Vector3 | null) {
    const people: { x: number; z: number }[][] = [[], [], []];
    if (p) people[this.playerFloor].push(p);
    for (const x of this.visitors) if (!x.riding) people[x.floor]?.push(x.pos);
    for (const s of this.staff) people[s.floor]?.push(s.pos);
    for (const d of this.doors) {
      const locked = d === this.cinemaDoor && this.cinema.state === 'showing';
      d.update(dt, !locked && d.sense(people[d.floor]), this.w.reduced);
    }
  }

  update(dt: number, player: THREE.Vector3, here: boolean) {
    this.time += dt;
    // Stepping out of the building (only possible downstairs) puts the player at street level.
    if (!here && this.playerFloor && !this.ride) {
      this.playerFloor = 0;
      this.w.player.pos.y = 0;
      this.rectsVersion++;
    }
    const p = here && !this.ride ? this.toLocal(player) : null;
    this.updateEscalator(dt, p);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = (VISITOR.every / this.upgradeValue('ads', this.lvl('ads'))) * rand(0.7, 1.3) / this.w.events.footfall;
      if (this.visitors.length < this.visitorMax && this.openShops().length) this.spawnVisitor();
    }
    for (const x of this.visitors) x.update(dt);
    for (const x of this.visitors.filter((y) => y.dead)) x.ch.root.removeFromParent();
    this.visitors = this.visitors.filter((x) => !x.dead);
    for (const s of this.staff) {
      s.update(dt);
      if (s.role === 'cleaner' && !s.leaving) this.interact(s, s.pos, s.floor);
    }
    for (const s of this.staff.filter((x) => x.gone)) s.ch.root.removeFromParent();
    this.staff = this.staff.filter((s) => !s.gone);
    this.updateCinema(dt, p);
    this.updateSafe(dt, p);
    this.updateDoors(dt, p);
    this.updateView(here);
    if (p) this.updateTiles(dt, p);
    this.persistT -= dt;
    if (this.persistT <= 0) {
      this.persistT = 1;
      this.persist();
    }
  }
}

/** A lighter tone of the brand colour for its shop floor. */
function tint(hex: string) {
  return `#${new THREE.Color(hex).lerp(new THREE.Color('#F4EAD8'), 0.72).getHexString()}`;
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One display in a shop, by kind: rails of clothes, shelves of bottles, screens, toys, cabinets, books. */
function fitting(kind: UnitKind, colours: string[], i: number): THREE.Group {
  const g = new THREE.Group();
  const c = (k: number) => colours[(i + k) % colours.length];
  switch (kind) {
    case 'clothes':
    case 'sport':
    case 'home': {
      g.add(at(box(2.0, 0.05, 0.05, C.steel, false), 0, 1.5, 0));
      for (const x of [-0.95, 0.95]) g.add(at(box(0.05, 1.5, 0.05, C.steel, false), x, 0.75, 0));
      for (let k = 0; k < 6; k++) g.add(at(box(0.26, 0.75, 0.3, c(k)), -0.75 + k * 0.3, 1.05, 0));
      break;
    }
    case 'shoes': {
      for (let r = 0; r < 3; r++) {
        g.add(at(box(2.0, 0.05, 0.5, '#E9E4DA'), 0, 0.4 + r * 0.45, 0));
        for (let k = 0; k < 4; k++) g.add(at(box(0.3, 0.14, 0.2, c(k + r)), -0.7 + k * 0.46, 0.5 + r * 0.45, 0));
      }
      break;
    }
    case 'beauty': {
      g.add(at(box(2.0, 1.7, 0.5, '#FBF8F2'), 0, 0.85, 0));
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 7; k++) g.add(at(cyl(0.06, 0.06, 0.22, 8, c(k + r), false), -0.8 + k * 0.27, 0.6 + r * 0.45, 0.28));
      }
      break;
    }
    case 'tech': {
      g.add(at(box(2.0, 0.9, 0.9, '#E9E4DA'), 0, 0.45, 0));
      for (let k = 0; k < 3; k++) {
        const scr = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.03), mat('#1E1E1E', '#8FB3C4', 0.5));
        scr.position.set(-0.6 + k * 0.6, 1.08, 0);
        scr.rotation.x = -0.3;
        g.add(scr);
      }
      break;
    }
    case 'toys': {
      g.add(at(box(2.0, 1.4, 0.5, '#FBF8F2'), 0, 0.7, 0));
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 5; k++) g.add(at(box(0.28, 0.28, 0.28, c(k * 2 + r)), -0.76 + k * 0.38, 0.35 + r * 0.42, 0.2));
      }
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat('#A0643A')), 0.6, 1.65, 0));
      break;
    }
    case 'arcade': {
      for (const x of [-0.55, 0.55]) {
        g.add(at(box(0.9, 1.7, 0.8, c(x > 0 ? 1 : 0)), x, 0.85, 0));
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), mat('#1E1E1E', '#F2C230', 0.8));
        scr.position.set(x, 1.3, 0.41);
        g.add(scr);
      }
      break;
    }
    case 'books': {
      g.add(at(box(2.0, 1.6, 0.4, '#6E4128'), 0, 0.8, 0));
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 8; k++) g.add(at(box(0.16, 0.34, 0.24, c(k + r)), -0.8 + k * 0.23, 0.35 + r * 0.48, 0.1));
      }
      break;
    }
    default:
      break;
  }
  return g;
}
