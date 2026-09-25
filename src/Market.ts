import * as THREE from 'three';
import { Door } from './stations/Door';
import { BAL, hireCost, hireMax, UPGRADES, upgradeCost, type HireDef, type HireId, type UpgradeId } from './config/balance';
import { buffAmount } from './config/city';
import {
  CHECKOUT_QUEUE, GROCERIES, LIST_KINDS, MARKET, MARKET_HIRES, MARKET_OPEN_COST, MARKET_ORIGIN, MARKET_UNLOCKS,
  marketRate, MAX_SHOPPERS, PALLET_CAP, PALLET_KINDS, SCAN_INTERVAL, SEGMENTS_PER_ROW, SHELF_CAP, SHELF_PRODUCTS,
  shopperInterval, STARTING_ROWS, STOCKER_CART, TRUCK_EVERY, TRUCK_REORDER_BELOW, wholesaleOf,
  type GroceryKind, type MarketUnlock,
} from './config/market';
import { Nav, type Rect } from './core/Nav';
import { writeSave, type SaveData } from './core/Save';
import { dist2 } from './entities/Agent';
import { MarketStaff } from './entities/MarketStaff';
import { Shopper, type Stop } from './entities/Shopper';
import type { Game } from './Game';
import type { Carrier } from './Shop';
import { Desk } from './stations/Props';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { ITEM_H, ItemStack, transfer, type Layout } from './systems/ItemStack';
import { fmtMoney } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { at, box, C, canvasTexture, cyl, makeGrocery, mat, roundRect, zoneDecal } from './world/Assets';
import { plane } from './world/Level';

export type MarketState = NonNullable<SaveData['market']>;

export interface Segment {
  row: number;
  seg: number;
  kind: GroceryKind;
  stack: ItemStack;
  cap: number;
  /** Middle of the shelf segment, and where to stand to pick from / fill it (the aisle behind). */
  center: THREE.Vector3;
  pick: THREE.Vector3;
  half: number;
}

export interface Pallet { kind: GroceryKind; stack: ItemStack; zone: THREE.Vector3 }

export interface Checkout {
  index: number;
  x: number;
  queue: Shopper[];
  serve: THREE.Vector3;
  cashierZone: THREE.Vector3;
  belt: ItemStack;
  staffCashier: MarketStaff | null;
  /** The manager standing in while the till has no cashier. */
  cover: MarketStaff | null;
  playerHere: boolean;
  serveT: number;
  rect: Rect;
}

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
/** Manager: seconds of history it looks at, pause between decisions, cash it never spends. */
const MANAGER_WINDOW = 30;
const MANAGER_COOLDOWN = 25;
const MANAGER_RESERVE = 20000;
const segKey = (row: number, seg: number) => `${row}:${seg}`;

/** Build a fresh market state: the front two aisles stocked, full pallets. */
export function freshMarket(): MarketState {
  const shelves: Record<string, number> = {};
  for (const r of STARTING_ROWS) for (let s = 0; s < SEGMENTS_PER_ROW; s++) shelves[segKey(r, s)] = SHELF_CAP;
  const pallets: Partial<Record<GroceryKind, number>> = {};
  for (const k of PALLET_KINDS) pallets[k] = PALLET_CAP;
  return { unlocked: [], paid: {}, upg: {}, hires: {}, pallets, shelves };
}

const rowsOf = (ms: { unlocked: string[] }) =>
  [...STARTING_ROWS, ...MARKET_UNLOCKS.filter((u) => u.kind === 'row' && ms.unlocked.includes(u.id)).map((u) => u.index)];
const checkoutsOf = (ms: { unlocked: string[] }) =>
  [0, ...MARKET_UNLOCKS.filter((u) => u.kind === 'checkout' && ms.unlocked.includes(u.id)).map((u) => u.index)];

/** TL/second the market makes on its own while the game is closed (needs a cashier and a stocker). */
export function marketStaffedIncome(data: SaveData) {
  const ms = data.market;
  if (!ms || !ms.hires.cashier || !ms.hires.stocker) return 0;
  return marketRate(rowsOf(ms).length, checkoutsOf(ms).length);
}

/** What the market is worth as a business: what went into it plus its earning power. */
export function marketAssets(data: SaveData) {
  const ms = data.market;
  if (!ms) return 0;
  return MARKET_OPEN_COST + MARKET_UNLOCKS.filter((u) => ms.unlocked.includes(u.id)).reduce((s, u) => s + u.cost, 0);
}

/** Item heights differ, so shelf and pallet piles lay items out in a grid of their own. */
const shelfLayout = (len: number): Layout => {
  const cols = SHELF_CAP / 2;
  const dx = (len - 0.8) / cols;
  return (i) => new THREE.Vector3((i % cols - (cols - 1) / 2) * dx, 0, (Math.floor(i / cols) - 0.5) * 0.46);
};
const palletLayout: Layout = (i, k) => {
  const r = i % 9;
  return new THREE.Vector3((r % 3 - 1) * 0.33, Math.floor(i / 9) * ITEM_H[k], (Math.floor(r / 3) - 1) * 0.33);
};
const beltLayout: Layout = (i) => new THREE.Vector3(0, 0, -(i % 8) * 0.26);

export const groceryMesh = (k: GroceryKind) => makeGrocery(k, GROCERIES[k].color, GROCERIES[k].label);

/**
 * The supermarket at the top of the side street. Its own local frame (origin at
 * MARKET_ORIGIN) and path grid; the sales floor is a maze of shelf rows that
 * shoppers walk end to end.
 */
export class Market {
  root = new THREE.Group();
  /** Local frame: the side street and plaza (z up to 46) are part of it, for shoppers walking in. */
  nav = new Nav(-18, -22, 22, 46);
  ms: MarketState;
  segments: Segment[] = [];
  pallets = new Map<GroceryKind, Pallet>();
  checkouts: Checkout[] = [];
  staff: MarketStaff[] = [];
  shoppers: Shopper[] = [];
  doors: Door[] = [];
  tiles: UnlockTile[] = [];
  hr: Desk | null = null;
  rects: Rect[] = [];
  rectsVersion = 0;
  served = 0;
  readonly id = 'market';
  readonly ox = MARKET_ORIGIN.x;
  readonly oz = MARKET_ORIGIN.z;
  def = { hires: MARKET_HIRES };

  private wallRects: Rect[] = [];
  private spawnT = 1;
  private truck: Truck;
  private persistT = 0;
  private playerLocal = new THREE.Vector3();
  private readonly spawnAt = v(-12, 43);
  private readonly exitRoute = [v(6, 15.6), v(-12, 17), v(-12, 43)];

  constructor(public w: Game) {
    this.ms = w.data.market!;
    this.root.position.set(this.ox, 0, this.oz);
    w.scene.add(this.root);
    this.buildShell();
    for (const r of rowsOf(this.ms)) this.addRow(r);
    PALLET_KINDS.forEach((k, i) => this.addPallet(k, i));
    for (const i of checkoutsOf(this.ms)) this.addCheckout(i);
    if (this.ms.unlocked.includes('mdesk')) this.addDesk();
    for (const h of MARKET_HIRES) for (let i = 0; i < this.hireCount(h.id); i++) this.spawnStaff(h, false);
    this.truck = new Truck(this);
    this.rebuildNav();
    this.refreshTiles();
  }

  get flyer() { return this.w.flyer; }
  get sfx() { return this.w.sfx; }
  get ss() { return this.ms; }

  toWorld(p: THREE.Vector3) { return new THREE.Vector3(p.x + this.ox, p.y, p.z + this.oz); }
  toLocal(p: THREE.Vector3) { return this.playerLocal.set(p.x - this.ox, 0, p.z - this.oz); }

  worldRects(): Rect[] {
    return this.rects.map((r) => ({ x0: r.x0 + this.ox, x1: r.x1 + this.ox, z0: r.z0 + this.oz, z1: r.z1 + this.oz }));
  }

  /** Share of the market's takings (and costs) that is the player's, after any public float. */
  private get share() { return this.w.ownerShare('market'); }

  // ---------- building ----------

  private wall(r: Rect, h: number, color: string, blocks = true) {
    const m = box(r.x1 - r.x0, h, r.z1 - r.z0, color);
    m.position.set((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);
    this.root.add(m);
    this.root.add(at(box(r.x1 - r.x0 + 0.06, 0.08, r.z1 - r.z0 + 0.06, C.woodDark, false), m.position.x, h + 0.04, m.position.z));
    if (blocks) this.wallRects.push(r);
    return m;
  }

  private buildShell() {
    const M = MARKET;
    const { halfW: W, halfD: D } = M;
    const T = 0.3;
    // Floor: pale tiles on the shop floor, concrete in the stockroom.
    const tiles = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#EDE8DD';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#D9D1C2';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, 128, 128);
    }).tex;
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(W, D);
    this.root.add(at(plane(W * 2, D * 2, tiles, 0), 0, 0.001, 0));
    const s = M.stock;
    this.root.add(at(plane(s.x1 - s.x0, s.z1 - s.z0, '#C9C1B4', 0), (s.x0 + s.x1) / 2, 0.002, (s.z0 + s.z1) / 2));
    // Checkout zone floor and the entrance mat.
    this.root.add(at(plane(W * 2 - 4, 0.1, '#2F5D8C', 0), 2, 0.004, 7.2));
    this.root.add(at(plane(3, 1.2, '#2F5D8C', 0), -13.5, 0.004, D - 0.7));

    // Walls: tall at the back, low sides, knee-high front so the camera sees the aisles.
    const back = this.wall({ x0: -W - T, x1: s.doorX0, z0: -D - T, z1: -D }, 2.6, '#E4DED2');
    back.castShadow = false;
    this.wall({ x0: s.doorX1, x1: W + T, z0: -D - T, z1: -D }, 2.6, '#E4DED2').castShadow = false;
    this.wall({ x0: -W - T, x1: -W, z0: -D, z1: D }, 1.3, '#D7CDBB');
    this.wall({ x0: W, x1: W + T, z0: -D, z1: D }, 1.3, '#D7CDBB');
    this.wall({ x0: -W - T, x1: M.entrance.x0, z0: D, z1: D + T }, 0.5, '#D7CDBB');
    this.wall({ x0: M.entrance.x1, x1: M.exit.x0, z0: D, z1: D + T }, 0.5, '#D7CDBB');
    this.wall({ x0: M.exit.x1, x1: W + T, z0: D, z1: D + T }, 0.5, '#D7CDBB');
    // Partition that makes the entry corridor down the left side.
    this.wall({ x0: M.partitionX - 0.1, x1: M.partitionX + 0.1, z0: M.partitionEnd, z1: D }, 1.3, '#2F5D8C');
    // Stockroom: walls round it, a roller door on the right for the truck.
    this.wall({ x0: s.x0 - T, x1: s.x0, z0: s.z0, z1: -D }, 2.2, '#D7CDBB');
    this.wall({ x0: s.x0 - T, x1: s.x1 + T, z0: s.z0 - T, z1: s.z0 }, 2.6, '#D7CDBB').castShadow = false;
    this.wall({ x0: s.x1, x1: s.x1 + T, z0: s.z0, z1: s.truckDoorZ0 }, 2.2, '#D7CDBB');
    this.wall({ x0: s.x1, x1: s.x1 + T, z0: s.truckDoorZ1, z1: -D }, 2.2, '#D7CDBB');
    // Automatic glass doors: one in the entrance, three across the wide checkout exit;
    // swing doors into the stockroom.
    const BLUE = '#2F5D8C';
    this.doors.push(new Door(this.root, { x: (M.entrance.x0 + M.entrance.x1) / 2, z: D + T / 2, width: M.entrance.x1 - M.entrance.x0, height: 1.5, style: 'slide', color: BLUE }));
    const bays = 3;
    const bay = (M.exit.x1 - M.exit.x0) / bays;
    for (let i = 0; i < bays; i++) {
      this.doors.push(new Door(this.root, { x: M.exit.x0 + bay * (i + 0.5), z: D + T / 2, width: bay, height: 1.5, style: 'slide', color: BLUE }));
    }
    this.doors.push(new Door(this.root, { x: (s.doorX0 + s.doorX1) / 2, z: -D - T / 2, width: s.doorX1 - s.doorX0, height: 2.2, style: 'swing', double: true, into: -1, color: '#8C8579' }));
    // The roller door stays shut to walkers.
    const door = box(0.12, 1.1, s.truckDoorZ1 - s.truckDoorZ0, '#8C8579');
    door.position.set(s.x1 + 0.15, 1.65, (s.truckDoorZ0 + s.truckDoorZ1) / 2);
    this.root.add(door);
    this.wallRects.push({ x0: s.x1, x1: s.x1 + T, z0: s.truckDoorZ0, z1: s.truckDoorZ1 });

    // Signs: the store's name on the back wall, "DEPO" over the stockroom door.
    const sign = canvasTexture(1024, 192, (ctx) => {
      ctx.fillStyle = '#2F5D8C';
      roundRect(ctx, 8, 8, 1008, 176, 40);
      ctx.fill();
      ctx.fillStyle = C.cream;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 112px "Baloo 2", sans-serif';
      ctx.fillText(TR.market.name.toLocaleUpperCase('tr-TR'), 512, 104);
    }).tex;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 }));
    signMesh.position.set(-4, 3.4, -D - 0.1);
    this.root.add(signMesh, at(box(8.3, 1.75, 0.12, C.woodDark), -4, 3.4, -D - 0.2));
    const depo = canvasTexture(256, 96, (ctx) => {
      ctx.fillStyle = C.dark;
      roundRect(ctx, 4, 4, 248, 88, 18);
      ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.font = '800 60px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.market.stockroom, 128, 52);
    }).tex;
    const depoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.68), new THREE.MeshStandardMaterial({ map: depo, roughness: 0.9 }));
    depoMesh.position.set((s.doorX0 + s.doorX1) / 2, 2.25, -D + 0.18);
    this.root.add(depoMesh);
  }

  private addRow(r: number) {
    const row = MARKET.rows[r];
    const len = row.x1 - row.x0;
    const segLen = len / SEGMENTS_PER_ROW;
    const H = MARKET.shelfHeight;
    const g = new THREE.Group();
    g.add(at(box(len, H, MARKET.rowDepth, '#E9E4DA'), (row.x0 + row.x1) / 2, H / 2, row.z));
    // End caps in the store colour make the rows read as one maze from above.
    for (const x of [row.x0 + 0.1, row.x1 - 0.1]) g.add(at(box(0.2, H + 0.1, MARKET.rowDepth + 0.08, '#2F5D8C'), x, (H + 0.1) / 2, row.z));
    for (let s = 0; s < SEGMENTS_PER_ROW; s++) {
      const kind = SHELF_PRODUCTS[r][s];
      const cx = row.x0 + segLen * (s + 0.5);
      // Price strips in the product's colours on both faces, and two shelf lips.
      for (const side of [-1, 1]) {
        g.add(at(box(segLen - 0.3, 0.12, 0.02, GROCERIES[kind].label, false), cx, H * 0.55, row.z + side * (MARKET.rowDepth / 2 + 0.01)));
        g.add(at(box(segLen - 0.3, 0.3, 0.02, GROCERIES[kind].color, false), cx, H * 0.3, row.z + side * (MARKET.rowDepth / 2 + 0.01)));
      }
      const anchor = at(new THREE.Object3D(), cx, H, row.z);
      g.add(anchor);
      const stack = new ItemStack(anchor, this.flyer, () => SHELF_CAP, shelfLayout(segLen));
      const seg: Segment = {
        row: r, seg: s, kind, stack, cap: SHELF_CAP,
        center: v(cx, row.z), pick: v(cx, row.z - MARKET.rowDepth / 2 - 0.6), half: segLen / 2,
      };
      const n = this.ms.shelves[segKey(r, s)] ?? 0;
      for (let i = 0; i < n; i++) stack.put(groceryMesh(kind), kind);
      this.segments.push(seg);
    }
    this.root.add(g);
    this.wallRects.push({ x0: row.x0, x1: row.x1, z0: row.z - MARKET.rowDepth / 2, z1: row.z + MARKET.rowDepth / 2 });
    return g;
  }

  private addPallet(kind: GroceryKind, i: number) {
    const x = MARKET.palletXs[i];
    const z = MARKET.palletZ;
    this.root.add(at(box(1.0, 0.14, 1.0, C.wood), x, 0.07, z));
    // A product-coloured card on the wall above each pallet says what goes there.
    this.root.add(at(box(0.8, 0.5, 0.04, GROCERIES[kind].color, false), x, 1.7, MARKET.stock.z0 + 0.04));
    this.root.add(at(box(0.8, 0.12, 0.05, GROCERIES[kind].label, false), x, 1.55, MARKET.stock.z0 + 0.05));
    const anchor = at(new THREE.Object3D(), x, 0.14, z);
    this.root.add(anchor);
    const stack = new ItemStack(anchor, this.flyer, () => PALLET_CAP, palletLayout);
    const n = this.ms.pallets[kind] ?? 0;
    for (let j = 0; j < n; j++) stack.put(groceryMesh(kind), kind);
    this.pallets.set(kind, { kind, stack, zone: v(x, z + 1.2) });
    this.wallRects.push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
  }

  private addCheckout(i: number) {
    const x = MARKET.checkouts[i];
    const z = MARKET.checkoutZ;
    const g = new THREE.Group();
    g.add(at(box(0.8, 0.9, 3.2, '#E9E4DA'), x, 0.45, z));
    g.add(at(box(0.84, 0.05, 3.24, '#2F5D8C', false), x, 0.92, z));
    g.add(at(box(0.5, 0.03, 2.2, C.dark, false), x, 0.95, z - 0.4));
    g.add(at(box(0.4, 0.26, 0.36, C.dark), x + 0.1, 1.08, z + 1.1));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.34), mat('#3A2A22', C.gold, 0.4));
    screen.position.set(x + 0.28, 1.34, z + 1.1);
    g.add(screen);
    // Lane number on a post.
    g.add(at(cyl(0.04, 0.04, 1.6, 6, C.dark), x + 0.3, 0.8, z - 1.5));
    const num = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.dark;
      ctx.font = '800 80px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 64, 70);
    }).tex;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: num, roughness: 0.8 }));
    plate.position.set(x + 0.3, 1.75, z - 1.5);
    g.add(plate);
    const anchor = at(new THREE.Object3D(), x, 0.97, z + 0.5);
    g.add(anchor);
    this.root.add(g);
    const cashierZone = v(x + 0.95, z + 0.6);
    const d = zoneDecal('register');
    d.position.set(cashierZone.x, 0.02, cashierZone.z);
    this.root.add(d);
    const k: Checkout = {
      index: i, x, queue: [], serve: v(x - 0.95, z + 0.6), cashierZone,
      belt: new ItemStack(anchor, this.flyer, () => 99, beltLayout, true),
      staffCashier: null, cover: null, playerHere: false, serveT: 0,
      rect: { x0: x - 0.4, x1: x + 0.4, z0: z - 1.6, z1: z + 1.6 },
    };
    this.checkouts.push(k);
    this.checkouts.sort((a, b) => a.index - b.index);
    return g;
  }

  private addDesk() {
    this.hr = new Desk(MARKET.desk, this.root, 'hr');
    return this.hr.group;
  }

  private rebuildNav() {
    this.rects = [
      ...this.wallRects,
      ...this.checkouts.map((k) => k.rect),
      ...(this.hr ? this.hr.rects : []),
    ];
    this.nav.rebuild(this.rects);
    this.rectsVersion++;
  }

  // ---------- unlocks ----------

  private unlockName(u: MarketUnlock) {
    return TR.market.unlock[u.kind](u.index);
  }

  private refreshTiles() {
    const locked = MARKET_UNLOCKS.filter((u) => !this.ms.unlocked.includes(u.id)).slice(0, 2);
    const wanted: TileDef[] = locked.map((u) => ({ id: u.id, cost: u.cost, x: u.x, z: u.z, label: this.unlockName(u) }));
    this.tiles = this.tiles.filter((t) => {
      if (wanted.some((w) => w.id === t.def.id)) return true;
      t.dispose();
      return false;
    });
    for (const w of wanted) {
      if (!this.tiles.some((t) => t.def.id === w.id)) this.tiles.push(new UnlockTile(w, this.ms.paid[w.id] ?? 0, this.root));
    }
  }

  private updateTiles(dt: number, p: THREE.Vector3) {
    for (const tile of [...this.tiles]) {
      tile.update(this.w.reduced ? 0 : this.w.time);
      if (!this.w.payTile(tile, dist2(p, tile.pos) < 0.95 * 0.95, dt, this.ms.paid)) continue;
      delete this.ms.paid[tile.def.id];
      tile.dispose();
      this.tiles = this.tiles.filter((t) => t !== tile);
      const u = MARKET_UNLOCKS.find((x) => x.id === tile.def.id)!;
      this.ms.unlocked.push(u.id);
      let obj: THREE.Object3D;
      if (u.kind === 'row') {
        // A new aisle arrives stocked.
        for (let s = 0; s < SEGMENTS_PER_ROW; s++) this.ms.shelves[segKey(u.index, s)] = SHELF_CAP;
        obj = this.addRow(u.index);
      } else if (u.kind === 'checkout') obj = this.addCheckout(u.index);
      else obj = this.addDesk();
      this.rebuildNav();
      this.w.celebrate(obj, this.toWorld(v(u.x, u.z)));
      this.w.hud.toast(TR.unlocked(this.unlockName(u)));
      this.refreshTiles();
      this.w.onBusinessProgress();
      this.persist();
      writeSave(this.w.data);
    }
  }

  // ---------- staff ----------

  hireCount(id: HireId) { return this.ms.hires[id] ?? 0; }

  lvl(id: UpgradeId) { return this.ms.upg[id] ?? 0; }

  upgradeValue(id: UpgradeId, lvl: number) {
    return id === 'sSpeed' ? BAL.staff.speed + BAL.staff.speedStep * lvl : BAL.staff.cap + BAL.staff.capStep * lvl;
  }

  get staffSpeed() { return this.upgradeValue('sSpeed', this.lvl('sSpeed')); }
  get stockerCap() { return this.upgradeValue('sCap', this.lvl('sCap')) * STOCKER_CART; }

  buyUpgrade(id: UpgradeId) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.lvl(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.max || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    this.ms.upg[id] = lvl + 1;
    this.sfx.play('register', 1, 0);
    this.w.panel.render();
    writeSave(this.w.data);
  }

  hire(id: HireId, byManager = false) {
    const h = MARKET_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    const cost = hireCost(h, n);
    if (n >= hireMax(h) || this.w.data.money < cost) return;
    if (h.requires && !this.ms.unlocked.includes(h.requires)) return;
    this.w.data.money -= cost;
    this.ms.hires[id] = n + 1;
    this.spawnStaff(h, true);
    if (!byManager) this.sfx.play('unlock', 1, 0);
    if (!byManager) this.w.hud.toast(TR.hiredToast(TR.hire[id].name));
    else if (this.w.area === this) this.w.hud.toast(TR.managerHired(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  fire(id: HireId, byManager = false) {
    const h = MARKET_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    if (!n) return;
    const k = h.role === 'cashier' ? this.checkouts.find((c) => c.index === h.counter) : null;
    const s = this.staff.filter((x) => x.role === h.role && !x.leaving && (!k || x.checkout === k)).pop();
    if (!s) return;
    s.dismiss(v(-12, 20));
    this.ms.hires[id] = n - 1;
    if (!byManager) this.w.hud.toast(TR.firedToast(TR.hire[id].name));
    else if (this.w.area === this) this.w.hud.toast(TR.managerFired(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  private spawnStaff(h: HireDef, walkIn: boolean) {
    const k = h.role === 'cashier' ? this.checkouts.find((c) => c.index === h.counter) ?? null : null;
    if (h.role === 'cashier' && !k) return;
    const i = this.staff.filter((s) => s.role === 'stocker').length;
    const home = k ? k.cashierZone.clone()
      : h.role === 'manager' ? v(13, 7) : v(9.2 + (i % 6) * 1.2, -16.2 + Math.floor(i / 6) * 0.6);
    const from = walkIn ? v(-13 + Math.random(), 17) : undefined;
    const s = new MarketStaff(h.role as 'cashier' | 'stocker' | 'manager', k, home, this, from);
    this.staff.push(s);
    this.root.add(s.ch.root);
  }

  // ---------- the manager ----------

  private mgr = { t: 0, cool: 0, fill: [] as number[], idle: [] as number[], queue: [] as number[] };

  /**
   * With a manager on the payroll the market staffs itself: a cashier for every
   * till, more stockers while the shelves run low and the team is busy, one fewer
   * when they stand around with full shelves. It always keeps a cash reserve.
   */
  private manage(dt: number) {
    if (!this.staff.some((s) => s.role === 'manager' && !s.leaving)) return;
    const m = this.mgr;
    m.t += dt;
    m.cool -= dt;
    if (m.t < 1) return;
    m.t = 0;
    const stockers = this.staff.filter((s) => s.role === 'stocker' && !s.leaving);
    const push = (a: number[], x: number) => { a.push(x); if (a.length > MANAGER_WINDOW) a.shift(); };
    push(m.fill, this.segments.reduce((s, x) => s + x.stack.count / x.cap, 0) / this.segments.length);
    push(m.idle, stockers.length ? stockers.filter((s) => !s.stack.count && !s.wants).length / stockers.length : 0);
    push(m.queue, this.checkouts.reduce((s, k) => s + k.queue.length, 0));
    if (m.cool > 0 || m.fill.length < MANAGER_WINDOW / 2) return;
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const affordable = (id: HireId) => {
      const h = MARKET_HIRES.find((x) => x.id === id)!;
      const n = this.hireCount(id);
      return n < hireMax(h) && (!h.requires || this.ms.unlocked.includes(h.requires))
        && this.w.data.money >= hireCost(h, n) + MANAGER_RESERVE;
    };
    const act = (fn: () => void) => { fn(); m.cool = MANAGER_COOLDOWN; m.fill = []; m.idle = []; m.queue = []; };
    const tills: HireId[] = ['cashier', 'checkout2', 'checkout3'];
    for (const k of this.checkouts) {
      if (!k.staffCashier && affordable(tills[k.index])) return act(() => this.hire(tills[k.index], true));
    }
    if (avg(m.fill) < 0.55 && avg(m.idle) < 0.25 && affordable('stocker')) return act(() => this.hire('stocker', true));
    if (avg(m.idle) > 0.6 && avg(m.fill) > 0.85 && stockers.length > 1) return act(() => this.fire('stocker', true));
  }

  // ---------- shoppers ----------

  private spawnShopper() {
    const segs = this.segments;
    const kinds = [...new Set(segs.map((s) => s.kind))];
    const nKinds = Math.min(kinds.length, LIST_KINDS[0] + Math.floor(Math.random() * (LIST_KINDS[1] - LIST_KINDS[0] + 1)));
    const want = kinds.sort(() => Math.random() - 0.5).slice(0, nKinds);
    // For each product, one of the shelves that carries it.
    const picks = want.map((k) => {
      const options = segs.filter((s) => s.kind === k);
      return { seg: options[Math.floor(Math.random() * options.length)], n: 1 + Math.floor(Math.random() * 3) };
    });
    const stops: Stop[] = [];
    const M = MARKET;
    const west = -10;
    const east = 13.5;
    // In at the front left, down the corridor to the back, then snake forward aisle by aisle.
    stops.push({ to: v(-13.6, 15.4) }, { to: v(-13.8, 12) }, { to: v(-13.9, M.aisles[0]) });
    for (let a = 0; a < M.rows.length; a++) {
      const rightward = a % 2 === 0;
      const onRow = picks.filter((p) => p.seg.row === a).sort((p, q) => (rightward ? p.seg.center.x - q.seg.center.x : q.seg.center.x - p.seg.center.x));
      for (const p of onRow) stops.push({ to: p.seg.pick.clone().add(v((Math.random() - 0.5) * p.seg.half, 0)), seg: p.seg, n: p.n });
      const z = M.aisles[a];
      stops.push({ to: v(rightward ? east : west, z) }, { to: v(rightward ? east : west, M.aisles[a + 1]) });
    }
    const s = new Shopper(this, stops, this.spawnAt.clone().add(v((Math.random() - 0.5) * 3, Math.random())));
    this.root.add(s.ch.root);
    this.shoppers.push(s);
  }

  takeFromShelf(seg: Segment, s: Shopper) {
    transfer(seg.stack, s.basket, 0.3);
    s.bought.push(seg.kind);
  }

  shelfEmpty(s: Shopper, seg: Segment) {
    const head = this.toWorld(s.pos.clone());
    head.y = 2.4;
    this.w.floats.spawn(head, TR.market.empty(TR.market.product[seg.kind]), 'angry');
  }

  /** Done shopping: the shortest queue, or out of the door if the basket is empty. */
  toCheckout(s: Shopper) {
    if (!s.basket.count) return s.leave(this.exitRoute, true);
    const open = this.checkouts.filter((k) => k.queue.length < CHECKOUT_QUEUE);
    if (!open.length) return this.gaveUp(s);
    const k = open.reduce((a, b) => (b.queue.length < a.queue.length ? b : a));
    k.queue.push(s);
    s.queueAt(k, this.slot(k, k.queue.length - 1));
  }

  private slot(k: Checkout, i: number) { return v(k.serve.x, k.serve.z - i * 0.95); }

  private leaveQueue(s: Shopper) {
    const k = s.checkout;
    if (!k) return;
    const i = k.queue.indexOf(s);
    if (i < 0) return;
    k.queue.splice(i, 1);
    k.queue.forEach((q, j) => { if (j >= i) q.goTo(this.nav, this.slot(k, j)); });
  }

  /** Waited too long: leaves the basket and walks out. */
  gaveUp(s: Shopper) {
    this.leaveQueue(s);
    s.basket.clear();
    const head = this.toWorld(s.pos.clone());
    head.y = 2.4;
    this.w.floats.spawn(head, TR.patience.left, 'angry');
    s.leave(this.exitRoute, true);
  }

  private updateCheckouts(dt: number, p: THREE.Vector3 | null) {
    for (const k of this.checkouts) {
      k.playerHere = !!p && dist2(p, k.cashierZone) < 0.8 * 0.8;
      k.serveT -= dt;
      const s = k.queue[0];
      const present = k.playerHere || !!k.staffCashier?.atPost || !!k.cover?.atPost;
      if (!s || !s.arrived || !present || k.serveT > 0) continue;
      k.serveT = SCAN_INTERVAL;
      if (s.basket.count) {
        transfer(s.basket, k.belt, 0.25);
        if (k.playerHere) this.sfx.play('tick', 1.6, 60);
        continue;
      }
      // Everything scanned: pay (into the account, the player's share of it) and go.
      const tips = 1 + buffAmount(this.w.data.buffs, 'tips');
      const total = s.bought.reduce((sum, kind) => sum + GROCERIES[kind].price, 0);
      const amount = Math.round(total * tips * this.w.bonusMult() * this.share);
      this.w.sale(amount);
      const at = this.toWorld(k.serve.clone());
      at.y = 2.2;
      this.w.floats.spawn(at, `+${fmtMoney(amount)}`);
      this.sfx.play('register', 1, 150);
      this.served++;
      k.belt.clear();
      this.leaveQueue(s);
      s.leave([v(s.pos.x, 13.2), ...this.exitRoute]);
      k.serveT = 0.6;
    }
  }

  // ---------- carrying ----------

  /** Pallet pick-ups and shelf filling, for the player and stockers alike. */
  interact(c: Carrier | MarketStaff, p: THREE.Vector3) {
    if (c.cd > 0) return;
    const st = c.stack;
    for (const pal of this.pallets.values()) {
      if (!pal.stack.count || !c.accepts.has(pal.kind) || !st.canAccept(pal.kind) || dist2(p, pal.zone) > 0.9 * 0.9) continue;
      if (c.wants !== undefined && c.wants !== pal.kind) continue;
      transfer(pal.stack, st);
      c.cd = BAL.transferInterval;
      if (c.isPlayer) this.sfx.play('pickup', 1 + st.count * 0.04);
      return;
    }
    const kind = st.kind as GroceryKind | null;
    if (!kind || !(kind in GROCERIES)) return;
    for (const seg of this.segments) {
      if (seg.kind !== kind || seg.stack.isFull) continue;
      if (c.dropAt !== undefined && (c.dropAt as unknown) !== seg) continue;
      if (Math.abs(p.x - seg.center.x) > seg.half + 0.2 || Math.abs(p.z - seg.center.z) > 1.6) continue;
      transfer(st, seg.stack);
      c.cd = BAL.transferInterval * 1.5;
      if (c.isPlayer) this.sfx.play('drop');
      return;
    }
  }

  deskAt(p: THREE.Vector3) {
    return this.hr && dist2(p, this.hr.zone) < 0.8 * 0.8 ? 'hr' as const : null;
  }

  get crowd() { return this.shoppers.length; }

  /** TL/second it's worth when running: for the share price. */
  incomePerSecond() {
    return marketRate(rowsOf(this.ms).length, this.checkouts.length);
  }

  /** Write shelf and pallet counts into the save. */
  persist() {
    for (const s of this.segments) this.ms.shelves[segKey(s.row, s.seg)] = s.stack.count;
    for (const p of this.pallets.values()) this.ms.pallets[p.kind] = p.stack.count;
  }

  /** Pay the wholesaler for goods as they come off the truck. */
  payWholesale(kind: GroceryKind) {
    const cost = wholesaleOf(kind) * this.share;
    if (this.w.data.money < cost) return false;
    this.w.data.money -= cost;
    return true;
  }

  // ---------- frame ----------

  update(dt: number, player: THREE.Vector3, here: boolean) {
    const p = here ? this.toLocal(player) : null;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = (shopperInterval(rowsOf(this.ms).length, this.checkouts.length) * (0.8 + Math.random() * 0.4)) / this.w.events.footfall;
      if (this.shoppers.length < MAX_SHOPPERS) this.spawnShopper();
    }
    for (const s of this.shoppers) s.update(dt);
    this.shoppers = this.shoppers.filter((s) => !s.dead);
    for (const s of this.staff) {
      s.update(dt);
      if (s.role !== 'cashier' && !s.leaving && !s.atPost) this.interact(s, s.pos);
    }
    this.manage(dt);
    for (const s of this.staff.filter((x) => x.gone)) s.ch.root.removeFromParent();
    this.staff = this.staff.filter((s) => !s.gone);
    this.updateCheckouts(dt, p);
    this.truck.update(dt);
    const people = [...(p ? [p] : []), ...this.shoppers.map((s) => s.pos), ...this.staff.map((s) => s.pos)];
    for (const d of this.doors) d.update(dt, d.sense(people), this.w.reduced);
    if (p) this.updateTiles(dt, p);
    this.persistT -= dt;
    if (this.persistT <= 0) {
      this.persistT = 1;
      this.persist();
    }
  }
}

/**
 * The wholesaler's lorry: when the stockroom runs low it comes up the service
 * lane behind the market, tops up every pallet (charging wholesale per item)
 * and drives off.
 */
class Truck {
  group = new THREE.Group();
  private state: 'away' | 'in' | 'unload' | 'out' = 'away';
  private path: THREE.Vector3[] = [];
  private t = TRUCK_EVERY * 0.5;
  private unloadT = 0;
  private readonly lane = 19.4;
  private readonly bay: THREE.Vector3;

  constructor(private m: Market) {
    const g = this.group;
    // Cab at the front (+z of the group), box body behind.
    g.add(at(box(2.1, 2.2, 3.6, '#F4F1EA'), 0, 1.5, -0.8));
    g.add(at(box(2.14, 0.4, 3.64, '#2F5D8C', false), 0, 1.9, -0.8));
    g.add(at(box(2.0, 1.5, 1.4, '#C8412B'), 0, 1.1, 1.8));
    g.add(at(box(1.8, 0.6, 0.05, '#3F5566', false), 0, 1.45, 2.51));
    for (const [x, z] of [[-1, -1.8], [1, -1.8], [-1, 1.7], [1, 1.7]]) {
      const wheel = cyl(0.42, 0.42, 0.3, 10, '#2A2622');
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.42, z);
      g.add(wheel);
    }
    g.visible = false;
    m.root.add(g);
    const s = MARKET.stock;
    this.bay = v(this.lane, (s.truckDoorZ0 + s.truckDoorZ1) / 2 + 0.6);
    // Service lane from the high street up behind the market.
    m.root.add(at(plane(3.4, 72, '#7A6C60', 0), this.lane, -0.008, 10));
  }

  private get low() {
    return [...this.m.pallets.values()].some((p) => p.stack.count < PALLET_CAP * TRUCK_REORDER_BELOW);
  }

  update(dt: number) {
    const g = this.group;
    switch (this.state) {
      case 'away':
        this.t -= dt;
        if (this.t > 0) return;
        this.t = TRUCK_EVERY;
        if (!this.low) return;
        this.state = 'in';
        g.visible = true;
        // In from the east along the high street, then up the service lane.
        g.position.set(60, 0, 48.6);
        this.path = [v(this.lane, 48.6), this.bay.clone()];
        return;
      case 'unload': {
        this.unloadT -= dt;
        if (this.unloadT > 0) return;
        this.unloadT = 0.06;
        const pal = [...this.m.pallets.values()].filter((p) => p.stack.count < PALLET_CAP)
          .sort((a, b) => a.stack.count - b.stack.count)[0];
        if (!pal || !this.m.payWholesale(pal.kind)) {
          this.state = 'out';
          this.path = [v(this.lane, -70)];
          return;
        }
        const o = groceryMesh(pal.kind);
        const from = new THREE.Vector3();
        g.getWorldPosition(from);
        from.y = 1.4;
        o.position.copy(from);
        this.m.w.scene.add(o);
        pal.stack.receive(o, pal.kind, 0.45);
        return;
      }
      default: {
        const t = this.path[0];
        if (!t) return;
        const dx = t.x - g.position.x;
        const dz = t.z - g.position.z;
        const d = Math.hypot(dx, dz);
        const step = 8 * dt;
        g.rotation.y = Math.atan2(dx, dz);
        if (d > step) {
          g.position.x += (dx / d) * step;
          g.position.z += (dz / d) * step;
          return;
        }
        g.position.copy(t);
        this.path.shift();
        if (this.path.length) return;
        if (this.state === 'in') this.state = 'unload';
        else {
          this.state = 'away';
          g.visible = false;
        }
      }
    }
  }
}
