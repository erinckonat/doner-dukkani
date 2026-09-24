import * as THREE from 'three';
import { BAL, hireCost, hireMax, UPGRADES, upgradeCost, type HireDef, type HireId, type UpgradeId } from './config/balance';
import { buffAmount } from './config/city';
import {
  AMENITY_BONUS, amenityMult, CHECKIN_TIME, CLEAN_TIME, HOTEL, HOTEL_HIRES, HOTEL_OPEN_COST, HOTEL_ORIGIN, HOTEL_UNLOCKS, hotelRate,
  RECEPTION_QUEUE, ROOM_PRICE, ROOMS, STARTING_ROOMS, TOWEL_EVERY, TOWEL_TRAY, UPPER_FLOOR, UPPER_START, type HotelUnlock, type RoomDef,
} from './config/hotel';
import { Nav, type Rect } from './core/Nav';
import { writeSave, type SaveData } from './core/Save';
import { dist2 } from './entities/Agent';
import { Guest } from './entities/Guest';
import { HotelStaff } from './entities/HotelStaff';
import type { Game } from './Game';
import type { Carrier } from './Shop';
import { Desk } from './stations/Props';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { gridLayout, ItemStack, transfer } from './systems/ItemStack';
import { fmtMoney } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { at, box, C, canvasTexture, cyl, floorDecal, makePlant, makeTowel, mat, roundRect, zoneDecal } from './world/Assets';
import { plane } from './world/Level';

export type HotelState = NonNullable<SaveData['hotel']>;

export interface Room {
  def: RoomDef;
  floor: number;
  unlocked: boolean;
  dirty: boolean;
  guest: Guest | null;
  /** Fresh towels laid on the bed for the next guest. */
  towel: ItemStack;
  cleanT: number;
  zone: THREE.Vector3;
  tidy: THREE.Object3D | null;
  messy: THREE.Object3D | null;
}

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);
const MANAGER_WINDOW = 30;
const MANAGER_COOLDOWN = 25;
const MANAGER_RESERVE = 50000;
const GOLD = '#C9A24A';
const NAVY = '#2E3A55';
const MARBLE = '#F2EEE6';

/** Floor ring with a folded towel: where towels are picked up and where a room is made up. */
function towelDecal(size = 1.4) {
  const { tex } = canvasTexture(256, 256, (ctx) => {
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,250,240,0.7)';
    ctx.fill();
    ctx.setLineDash([26, 16]);
    ctx.lineWidth = 10;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#FBF8F2';
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 8;
    roundRect(ctx, 64, 92, 128, 72, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillRect(68, 136, 120, 14);
  });
  return floorDecal(tex, size);
}

export const freshHotel = (): HotelState => ({ unlocked: [], paid: {}, upg: {}, hires: {}, dirty: [] });

const roomsOf = (hs: { unlocked: string[] }) => [
  ...STARTING_ROOMS,
  ...(hs.unlocked.includes(UPPER_FLOOR.id) ? UPPER_START : []),
  ...HOTEL_UNLOCKS.filter((u) => u.kind === 'room' && hs.unlocked.includes(u.id)).map((u) => u.index),
];

/** Anyone who moves between the floors. */
interface Rider { floor: number; pos: THREE.Vector3 }

const H = HOTEL.floorH;

/** TL/second the hotel makes while the game is closed (needs a receptionist and a housekeeper). */
export function hotelStaffedIncome(data: SaveData) {
  const hs = data.hotel;
  if (!hs || !hs.hires.receptionist || !hs.hires.housekeeper) return 0;
  return hotelRate(roomsOf(hs), hs.unlocked);
}

export function hotelAssets(data: SaveData) {
  const hs = data.hotel;
  if (!hs) return 0;
  return HOTEL_OPEN_COST + [...HOTEL_UNLOCKS, UPPER_FLOOR].filter((u) => hs.unlocked.includes(u.id)).reduce((s, u) => s + u.cost, 0);
}

/**
 * The five-star hotel. Its own local frame (origin HOTEL_ORIGIN) and a path grid
 * per floor; the ground floor's reaches out to the pavement for guests arriving.
 * The upper floor sits a storey up (the `upper` group) and is reached by the lift.
 * It's drawn when the player is up there, or from outside (with a facade over
 * the ground floor); walk into the lobby and it lifts away so you can see in.
 */
export class Hotel {
  root = new THREE.Group();
  upper = new THREE.Group();
  navs = [new Nav(-14, -11, 14, 18), new Nav(-14, -11, 14, 18)];
  get nav() { return this.navs[0]; }
  navFor(floor: number) { return this.navs[floor]; }
  /** Which floor the player is on while in the hotel. */
  playerFloor = 0;
  lift = v(HOTEL.lift[0], HOTEL.lift[1]);
  hs: HotelState;
  rooms: Room[] = [];
  staff: HotelStaff[] = [];
  guests: Guest[] = [];
  queue: Guest[] = [];
  tiles: UnlockTile[] = [];
  hr: Desk | null = null;
  rects: Rect[][] = [[], []];
  rectsVersion = 0;
  served = 0;
  readonly id = 'hotel';
  readonly ox = HOTEL_ORIGIN.x;
  readonly oz = HOTEL_ORIGIN.z;
  def = { hires: HOTEL_HIRES };

  /** Fresh towels on each floor (the laundry downstairs, a linen room upstairs) and where to take them. */
  laundries: (ItemStack | null)[] = [null, null];
  get laundry() { return this.laundries[0]!; }
  laundryZone = v(HOTEL.laundry[0] + 1.1, HOTEL.laundry[1]);
  /** Behind the reception desk, and where the guest at the front stands. */
  deskZone = v(HOTEL.reception[0], HOTEL.reception[1] - 1.1);
  private serve = v(HOTEL.reception[0], HOTEL.reception[1] + 1.25);
  cover: HotelStaff | null = null;
  playerAtDesk = false;

  private wallRects: Rect[][] = [[], []];
  private liftHold = 0;
  private liftLock = false;
  private spawnT = 2;
  private serveT = 0;
  private towelT = 0;
  private persistT = 0;
  private playerLocal = new THREE.Vector3();
  private mgr = { t: 0, cool: 0, dirty: [] as number[], idle: [] as number[] };
  private readonly street = 15.8;

  constructor(public w: Game) {
    this.hs = w.data.hotel!;
    this.root.position.set(this.ox, 0, this.oz);
    this.upper.position.y = H;
    this.upper.visible = false;
    this.root.add(this.upper);
    w.scene.add(this.root);
    this.buildShell();
    this.buildReception();
    this.laundries[0] = this.buildLaundry(0);
    if (this.upperBuilt) this.buildUpper();
    const open = new Set(roomsOf(this.hs));
    for (const d of ROOMS) {
      const r: Room = {
        floor: d.floor,
        def: d, unlocked: false, dirty: false, guest: null, cleanT: 0, zone: v(d.zone[0], d.zone[1]), tidy: null, messy: null,
        towel: new ItemStack(new THREE.Object3D(), this.flyer, () => 1, gridLayout(1, 1, 0, 0)),
      };
      this.rooms.push(r);
      if (open.has(d.index)) this.furnish(r);
    }
    for (const i of this.hs.dirty ?? []) if (this.rooms[i]?.unlocked) this.setDirty(this.rooms[i], true);
    if (this.hs.unlocked.includes('hdesk')) this.addDesk();
    if (this.hs.unlocked.includes('buffet')) this.addBuffet();
    if (this.hs.unlocked.includes('spa')) this.addSpa();
    if (this.upperBuilt) this.buildLift(0);
    if (this.hs.unlocked.includes('terrace')) this.addTerraceBar();
    for (const h of HOTEL_HIRES) for (let i = 0; i < this.hireCount(h.id); i++) this.spawnStaff(h, false);
    this.rebuildNav();
    this.refreshTiles();
  }

  get flyer() { return this.w.flyer; }
  get sfx() { return this.w.sfx; }
  get ss() { return this.hs; }

  toWorld(p: THREE.Vector3) { return new THREE.Vector3(p.x + this.ox, p.y, p.z + this.oz); }
  toLocal(p: THREE.Vector3) { return this.playerLocal.set(p.x - this.ox, 0, p.z - this.oz); }

  get upperBuilt() { return this.hs.unlocked.includes(UPPER_FLOOR.id); }

  private group(floor: number) { return floor ? this.upper : this.root; }

  /** Collision for the player: the floor they're on. */
  worldRects(): Rect[] {
    return this.rects[this.playerFloor].map((r) => ({ x0: r.x0 + this.ox, x1: r.x1 + this.ox, z0: r.z0 + this.oz, z1: r.z1 + this.oz }));
  }

  private get share() { return this.w.ownerShare('hotel'); }

  get receptionist() { return this.staff.find((s) => s.role === 'receptionist' && !s.leaving) ?? null; }

  // ---------- building ----------

  private wall(r: Rect, h: number, color: string, floor = 0) {
    const g = this.group(floor);
    const m = box(r.x1 - r.x0, h, r.z1 - r.z0, color);
    m.position.set((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);
    g.add(m);
    g.add(at(box(r.x1 - r.x0 + 0.06, 0.07, r.z1 - r.z0 + 0.06, GOLD, false), m.position.x, h + 0.035, m.position.z));
    this.wallRects[floor].push(r);
    return m;
  }

  /** Room shells on one floor: carpets, corridor walls with doors, numbers. */
  private buildRoomShells(floor: number) {
    const g = this.group(floor);
    const RH = 1.2;
    const D = HOTEL.halfD;
    const rooms = ROOMS.filter((d) => d.floor === floor);
    for (const d of rooms) {
      const carpet = d.suite ? '#6B3A4A' : '#3F4F6B';
      g.add(at(plane(d.x1 - d.x0 - 0.2, d.z1 - d.z0 - 0.2, carpet, 0), (d.x0 + d.x1) / 2, 0.003, (d.z0 + d.z1) / 2));
      this.wall({ x0: d.x0, x1: d.doorX0, z0: d.wallZ - 0.08, z1: d.wallZ + 0.08 }, RH, '#E9E1D2', floor);
      this.wall({ x0: d.doorX1, x1: d.x1, z0: d.wallZ - 0.08, z1: d.wallZ + 0.08 }, RH, '#E9E1D2', floor);
      const num = canvasTexture(128, 64, (ctx) => {
        ctx.fillStyle = GOLD;
        ctx.font = '800 44px "Baloo 2", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(d.number), 64, 36);
      }).tex;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: num, transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2;
      // Back rooms: in the corridor beside the door; suites: just inside their door.
      if (d.suite) label.position.set(d.door[0], 0.01, d.wallZ + 0.55);
      else label.position.set(d.door[0] - 1.1, 0.01, d.door[1]);
      g.add(label);
    }
    // Partitions: between the back rooms, and around the suites across the corridor.
    for (const d of rooms.filter((x) => !x.suite).slice(1)) {
      this.wall({ x0: d.x0 - 0.08, x1: d.x0 + 0.08, z0: -D, z1: -4.5 }, RH, '#E9E1D2', floor);
    }
    const suites = rooms.filter((x) => x.suite);
    for (const d of suites) {
      if (d.x0 > -HOTEL.halfW + 0.1) this.wall({ x0: d.x0 - 0.08, x1: d.x0 + 0.08, z0: -1.5, z1: 3.5 }, RH, '#E9E1D2', floor);
    }
    if (suites.length) this.wall({ x0: suites[0].x0, x1: HOTEL.halfW, z0: 3.42, z1: 3.58 }, RH, '#E9E1D2', floor);
  }

  /** The lift: a gold-framed door and a pad in front of it, on the given floor. */
  private buildLift(floor: number) {
    const g = this.group(floor);
    const [x, z] = HOTEL.lift;
    const bz = z - 1.05;
    g.add(at(box(1.8, 2.5, 0.2, '#E9E1D2'), x, 1.25, bz), at(box(1.9, 0.12, 0.26, GOLD), x, 2.5, bz));
    for (const dx of [-0.36, 0.36]) g.add(at(box(0.66, 2.0, 0.04, '#B9A77A', false), x + dx, 1.0, bz + 0.12));
    g.add(at(box(0.3, 0.3, 0.05, NAVY, false), x, 2.25, bz + 0.13));
    this.wallRects[floor].push({ x0: x - 0.9, x1: x + 0.9, z0: bz - 0.1, z1: bz + 0.1 });
    const { tex } = canvasTexture(256, 256, (ctx) => {
      ctx.beginPath();
      ctx.arc(128, 128, 112, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(46,58,85,0.85)';
      ctx.fill();
      ctx.lineWidth = 10;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      // Up and down arrows.
      ctx.moveTo(128, 40); ctx.lineTo(168, 88); ctx.lineTo(88, 88); ctx.closePath();
      ctx.moveTo(128, 216); ctx.lineTo(168, 168); ctx.lineTo(88, 168); ctx.closePath();
      ctx.fill();
      ctx.font = '800 34px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.hotel.lift, 128, 130);
    });
    const pad = floorDecal(tex, 1.5);
    pad.position.set(x, 0.02, z);
    g.add(pad);
    return g;
  }

  /**
   * The upper floor: slab, walls, rooms along the back and suites across, a linen
   * room, a lounge by the lift and a terrace along the front; plus the facade that
   * closes in the ground floor when the hotel is seen from outside.
   */
  private buildUpper() {
    const g = this.upper;
    const { halfW: W, halfD: D } = HOTEL;
    const T = 0.3;
    g.add(at(box(2 * W + 2 * T, 0.25, 2 * D + 2 * T, '#E4DCCB'), 0, -0.125, 0));
    const floor = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#EFE8DA';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(201,162,74,0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 126, 126);
    }).tex;
    floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(W, D);
    g.add(at(plane(W * 2, D * 2, floor, 0), 0, 0.002, 0));
    g.add(at(plane(W * 2 - 1, 1.6, NAVY, 0), 0, 0.004, -3));
    const tr = HOTEL.terrace;
    g.add(at(plane(tr.x1 - tr.x0 - 0.2, tr.z1 - tr.z0 - 0.2, '#B98A5A', 0), (tr.x0 + tr.x1) / 2, 0.004, (tr.z0 + tr.z1) / 2));

    this.wall({ x0: -W - T, x1: W + T, z0: -D - T, z1: -D }, 2.8, '#EDE6D8', 1).castShadow = false;
    this.wall({ x0: -W - T, x1: -W, z0: -D, z1: D }, 1.3, '#E4DCCB', 1);
    this.wall({ x0: W, x1: W + T, z0: -D, z1: D }, 1.3, '#E4DCCB', 1);
    // Glass balustrade along the front.
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 2 * T, 1.0, 0.08),
      new THREE.MeshStandardMaterial({ color: '#BFD9E6', transparent: true, opacity: 0.35, roughness: 0.1 }));
    glass.position.set(0, 0.5, D + T / 2);
    g.add(glass, at(box(2 * W + 2 * T, 0.06, 0.14, GOLD, false), 0, 1.03, D + T / 2));
    this.wallRects[1].push({ x0: -W - T, x1: W + T, z0: D, z1: D + T });

    this.buildRoomShells(1);
    this.laundries[1] = this.buildLaundry(1);
    this.buildLift(1);

    // Lounge by the lift, terrace furniture.
    g.add(at(box(2.2, 0.45, 0.8, NAVY), -8.2, 0.22, 6.2), at(box(2.2, 0.7, 0.2, NAVY), -8.2, 0.55, 5.8));
    g.add(at(cyl(0.45, 0.45, 0.4, 12, GOLD), -8.2, 0.2, 7.4));
    this.wallRects[1].push({ x0: -9.3, x1: -7.1, z0: 5.7, z1: 6.65 }, { x0: -8.65, x1: -7.75, z0: 6.95, z1: 7.85 });
    for (const x of [-2.5, 0.5]) {
      const lounger = box(0.6, 0.25, 1.7, '#FBF8F2');
      g.add(at(lounger, x, 0.3, 6.6));
      this.wallRects[1].push({ x0: x - 0.3, x1: x + 0.3, z0: 5.75, z1: 7.45 });
    }
    for (const [x, z] of [[-W + 0.6, D - 0.6], [W - 0.6, D - 0.6], [-4.1, 4.0]] as const) {
      g.add(at(makePlant(), x, 0, z));
      this.wallRects[1].push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
    }

    // Facade over the ground floor: seen only from outside (the group hides when you walk into the lobby).
    const face = new THREE.Group();
    const wallMat = '#E4DCCB';
    const dz = D + T / 2;
    face.add(at(box(W + HOTEL.door.x0 + T + 0.04, H, T + 0.06, wallMat), (-W - T + HOTEL.door.x0) / 2, -H / 2, dz));
    face.add(at(box(W - HOTEL.door.x1 + T + 0.04, H, T + 0.06, wallMat), (HOTEL.door.x1 + W + T) / 2, -H / 2, dz));
    face.add(at(box(HOTEL.door.x1 - HOTEL.door.x0, H - 2.6, T + 0.06, wallMat), 0, -(H - 2.6) / 2, dz));
    for (const x of [-W - T / 2, W + T / 2]) face.add(at(box(T + 0.06, H, 2 * D, wallMat), x, -H / 2, 0));
    for (let x = -W + 1.5; x < W - 1; x += 3) {
      if (Math.abs(x) < 3) continue;
      face.add(at(box(1.6, 1.5, 0.04, '#6F8FA8', false), x, -H + 1.7, D + T + 0.05));
      face.add(at(box(1.7, 0.08, 0.06, GOLD, false), x, -H + 2.5, D + T + 0.05));
    }
    g.add(face);
  }

  private buildShell() {
    const { halfW: W, halfD: D } = HOTEL;
    const T = 0.3;
    // Marble lobby floor, a red carpet from the door to reception.
    const marble = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = MARBLE;
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#E4DDD0';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillRect(64, 64, 64, 64);
      ctx.strokeStyle = 'rgba(201,162,74,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 126, 126);
    }).tex;
    marble.wrapS = marble.wrapT = THREE.RepeatWrapping;
    marble.repeat.set(W, D);
    this.root.add(at(plane(W * 2, D * 2, marble, 0), 0, 0.001, 0));
    this.root.add(at(plane(2.2, 5.2, '#8E2B2B', 0), -3.2, 0.004, 6.8));
    this.root.add(at(plane(2.6, 0.12, GOLD, 0), 0, 0.005, D - 0.2));
    // Corridor runner.
    this.root.add(at(plane(W * 2 - 1, 1.6, NAVY, 0), 0, 0.004, -3));

    const back = this.wall({ x0: -W - T, x1: W + T, z0: -D - T, z1: -D }, 2.8, '#EDE6D8');
    back.castShadow = false;
    this.wall({ x0: -W - T, x1: -W, z0: -D, z1: D }, 1.3, '#E4DCCB');
    this.wall({ x0: W, x1: W + T, z0: -D, z1: D }, 1.3, '#E4DCCB');
    this.wall({ x0: -W - T, x1: HOTEL.door.x0, z0: D, z1: D + T }, 0.55, '#E4DCCB');
    this.wall({ x0: HOTEL.door.x1, x1: W + T, z0: D, z1: D + T }, 0.55, '#E4DCCB');

    // Room walls: every room's shell stands from the start; locked ones are empty.
    this.buildRoomShells(0);

    // Name and five stars on the back wall.
    const sign = canvasTexture(1024, 256, (ctx) => {
      ctx.fillStyle = NAVY;
      roundRect(ctx, 8, 8, 1008, 240, 48);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 104px "Baloo 2", sans-serif';
      ctx.fillText(TR.hotel.name.toLocaleUpperCase('tr-TR'), 512, 112);
      // Five stars drawn as paths (fonts may lack the glyph).
      for (let i = 0; i < 5; i++) {
        const cx = 512 + (i - 2) * 58;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 11 : 24;
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          ctx.lineTo(cx + Math.cos(a) * r, 200 + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
    }).tex;
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }));
    signMesh.position.set(0, 3.9, -D - 0.12);
    this.root.add(signMesh);

    // A canopy over the entrance, lamps, and plants either side of the door.
    for (const x of [-2, 2]) this.root.add(at(cyl(0.07, 0.07, 2.4, 8, GOLD), x, 1.2, D + 1.2));
    this.root.add(at(box(4.6, 0.12, 1.6, NAVY), 0, 2.45, D + 0.7));
    for (const [x, z] of [[-2.6, D + 0.6], [2.6, D + 0.6], [-W + 0.6, D - 0.6], [W - 0.6, -D + 0.6]] as const) {
      this.root.add(at(makePlant(), x, 0, z));
      this.wallRects[0].push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
    }
    // Lobby sofas facing each other near the door.
    for (const z of [5.6, 8.2]) {
      this.root.add(at(box(2.2, 0.45, 0.8, NAVY), 2.6, 0.22, z), at(box(2.2, 0.7, 0.2, NAVY), 2.6, 0.55, z + (z < 7 ? -0.4 : 0.4)));
      this.wallRects[0].push({ x0: 1.5, x1: 3.7, z0: z - 0.45, z1: z + 0.45 });
    }
    this.root.add(at(cyl(0.45, 0.45, 0.4, 12, GOLD), 2.6, 0.2, 6.9));
  }

  private buildReception() {
    const [x, z] = HOTEL.reception;
    const L = HOTEL.receptionLen;
    this.root.add(at(box(L, 1.05, 0.8, '#F7F3EC'), x, 0.525, z), at(box(L + 0.1, 0.08, 0.9, GOLD), x, 1.09, z));
    this.root.add(at(box(L - 0.2, 0.14, 0.02, NAVY, false), x, 0.7, z + 0.41));
    this.root.add(at(cyl(0.08, 0.1, 0.08, 10, GOLD), x + 0.9, 1.17, z + 0.15));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), mat(C.dark, GOLD, 0.3));
    screen.position.set(x - 0.6, 1.33, z - 0.15);
    this.root.add(screen);
    this.wallRects[0].push({ x0: x - L / 2, x1: x + L / 2, z0: z - 0.4, z1: z + 0.4 });
    const d = zoneDecal('register');
    d.position.set(this.deskZone.x, 0.02, this.deskZone.z);
    this.root.add(d);
  }

  /** A washer downstairs, a linen cabinet upstairs: both keep a pile of fresh towels on top. */
  private buildLaundry(floor: number) {
    const [x, z] = HOTEL.laundry;
    const parent = this.group(floor);
    const g = new THREE.Group();
    if (floor === 0) {
      g.add(at(box(1.0, 1.0, 1.0, '#F4F1EA'), 0, 0.5, 0));
      const porthole = cyl(0.3, 0.3, 0.05, 16, '#8FB3C9', false);
      porthole.rotation.z = Math.PI / 2;
      g.add(at(porthole, 0.51, 0.5, 0));
      g.add(at(box(0.04, 0.12, 0.6, GOLD, false), 0.51, 0.88, 0));
    } else {
      g.add(at(box(1.0, 1.0, 1.0, C.woodDark), 0, 0.5, 0));
      for (const y of [0.35, 0.7]) g.add(at(box(0.04, 0.26, 0.9, '#FBF8F2', false), 0.51, y, 0));
    }
    g.position.set(x, 0, z);
    parent.add(g);
    this.wallRects[floor].push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5 });
    const anchor = at(new THREE.Object3D(), x, 1.0, z);
    parent.add(anchor);
    const d = towelDecal();
    d.position.set(this.laundryZone.x, 0.02, this.laundryZone.z);
    parent.add(d);
    return new ItemStack(anchor, this.flyer, () => TOWEL_TRAY, gridLayout(2, 2, 0.36, 0.26));
  }

  /** Bed, bathroom and nightstand: a room opens for guests. */
  private furnish(r: Room) {
    const d = r.def;
    r.unlocked = true;
    const g = new THREE.Group();
    const [bx, bz] = d.bed;
    const head = d.yaw === 0 ? -1 : 1;
    const bw = d.suite ? 2.0 : 1.7;
    g.add(at(box(bw, 0.35, 2.1, C.woodDark), bx, 0.175, bz));
    g.add(at(box(bw - 0.1, 0.18, 2.0, '#FBF8F2'), bx, 0.44, bz));
    g.add(at(box(bw + 0.1, 0.9, 0.12, d.suite ? GOLD : C.woodDark), bx, 0.45, bz + head * 1.06));
    for (const dx of [-0.4, 0.4]) g.add(at(box(0.6, 0.12, 0.35, '#FFFFFF', false), bx + dx * (bw / 1.7), 0.59, bz + head * 0.72));
    const tidy = at(box(bw - 0.06, 0.08, 1.3, d.suite ? '#8E2B2B' : NAVY), bx, 0.57, bz - head * 0.3);
    const messy = new THREE.Group();
    const m1 = box(bw * 0.7, 0.14, 1.0, d.suite ? '#8E2B2B' : NAVY);
    m1.rotation.y = 0.5;
    const m2 = box(0.8, 0.1, 0.7, '#FBF8F2');
    m2.rotation.y = -0.4;
    messy.add(at(m1, bx - 0.15, 0.6, bz - head * 0.1), at(m2, bx + 0.3, 0.6, bz - head * 0.6));
    g.add(tidy, messy);
    messy.visible = false;
    r.tidy = tidy;
    r.messy = messy;
    // Towels are laid at the foot of the bed.
    const anchor = at(new THREE.Object3D(), bx, 0.62, bz - head * 0.75);
    g.add(anchor);
    r.towel.anchor = anchor;
    // Bathroom pod.
    const [tx, tz] = d.bath;
    g.add(at(box(1.0, 1.0, 1.2, '#DCE6EA'), tx, 0.5, tz), at(box(1.02, 0.05, 1.22, GOLD, false), tx, 1.02, tz));
    // Nightstand with a lamp beside the pillows.
    const nx = bx - (bw / 2 + 0.35);
    const nz = bz + head * 0.75;
    g.add(at(box(0.45, 0.5, 0.45, C.woodDark), nx, 0.25, nz), at(cyl(0.12, 0.16, 0.3, 8, GOLD), nx, 0.65, nz));
    if (d.suite) {
      // Suites get an armchair and a rug.
      g.add(at(box(0.8, 0.45, 0.8, '#6B3A4A'), d.x1 - 0.7, 0.22, (d.z0 + d.z1) / 2 - 1.3));
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1), mat('#C9A24A'));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(bx, 0.006, bz - head * 1.7);
      g.add(rug);
    }
    this.group(d.floor).add(g);
    const zone = towelDecal(1.1);
    zone.position.set(r.zone.x, 0.02, r.zone.z);
    g.add(zone);
    this.wallRects[d.floor].push(
      { x0: bx - bw / 2, x1: bx + bw / 2, z0: bz - 1.05, z1: bz + 1.05 },
      { x0: tx - 0.5, x1: tx + 0.5, z0: tz - 0.6, z1: tz + 0.6 },
      { x0: nx - 0.22, x1: nx + 0.22, z0: nz - 0.22, z1: nz + 0.22 },
    );
    // A new room comes made up, towels on the bed.
    const t = makeTowel();
    r.towel.put(t, 'towel');
    return g;
  }

  private setDirty(r: Room, dirty: boolean) {
    r.dirty = dirty;
    r.cleanT = 0;
    if (r.tidy) r.tidy.visible = !dirty;
    if (r.messy) r.messy.visible = dirty;
    if (dirty) r.towel.clear();
  }

  private addDesk() {
    this.hr = new Desk(HOTEL.desk, this.root, 'hr');
    return this.hr.group;
  }

  private addBuffet() {
    const [x, z] = HOTEL.buffet;
    const g = new THREE.Group();
    g.add(at(box(0.8, 0.95, 2.4, '#F7F3EC'), x, 0.475, z), at(box(0.9, 0.06, 2.5, GOLD), x, 0.98, z));
    const dishes = ['#E3A64A', '#C8412B', '#6F8F4E', '#F4EAD8', '#8C4A26'];
    dishes.forEach((c, i) => g.add(at(cyl(0.16, 0.12, 0.1, 10, c, false), x, 1.06, z - 0.95 + i * 0.48)));
    g.add(at(cyl(0.12, 0.12, 0.35, 10, '#C0C6CC', false), x - 0.15, 1.2, z + 1.05));
    this.root.add(g);
    this.wallRects[0].push({ x0: x - 0.4, x1: x + 0.4, z0: z - 1.2, z1: z + 1.2 });
    return g;
  }

  /** Teras bar upstairs: a counter with stools and bottles. */
  private addTerraceBar() {
    const [x, z] = HOTEL.bar;
    const g = new THREE.Group();
    g.add(at(box(3.2, 1.05, 0.8, C.woodDark), x, 0.525, z), at(box(3.3, 0.08, 0.9, GOLD), x, 1.09, z));
    ['#3E6B5A', '#8E2B2B', '#E3A64A', '#F4EAD8'].forEach((c, i) => g.add(at(cyl(0.05, 0.06, 0.3, 8, c, false), x - 1.1 + i * 0.7, 1.28, z - 0.15)));
    for (const dx of [-1, 0, 1]) g.add(at(cyl(0.2, 0.2, 0.08, 10, NAVY), x + dx, 0.7, z + 0.75), at(cyl(0.04, 0.04, 0.66, 6, GOLD), x + dx, 0.33, z + 0.75));
    this.upper.add(g);
    this.wallRects[1].push({ x0: x - 1.6, x1: x + 1.6, z0: z - 0.4, z1: z + 0.4 });
    return g;
  }

  private addSpa() {
    const P = HOTEL.pool;
    const g = new THREE.Group();
    const cx = (P.x0 + P.x1) / 2;
    const cz = (P.z0 + P.z1) / 2;
    g.add(at(box(P.x1 - P.x0 + 0.4, 0.12, P.z1 - P.z0 + 0.4, '#E9E4DA'), cx, 0.06, cz));
    const water = new THREE.Mesh(new THREE.BoxGeometry(P.x1 - P.x0, 0.06, P.z1 - P.z0), mat('#4FA3C7', '#2F7FA3', 0.25));
    water.position.set(cx, 0.1, cz);
    g.add(water);
    for (const dz of [-0.9, 0.9]) {
      const lounger = box(0.6, 0.2, 1.6, '#FBF8F2');
      lounger.rotation.y = Math.PI / 2;
      g.add(at(lounger, P.x1 - 1.2 + dz * 1.4, 0.3, P.z0 - 0.6));
    }
    const spa = canvasTexture(256, 96, (ctx) => {
      ctx.fillStyle = NAVY;
      roundRect(ctx, 4, 4, 248, 88, 20);
      ctx.fill();
      ctx.fillStyle = GOLD;
      ctx.font = '800 54px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TR.hotel.spaSign, 128, 52);
    }).tex;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.68), new THREE.MeshBasicMaterial({ map: spa, transparent: true, depthWrite: false }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(cx, 0.15, cz);
    g.add(label);
    this.root.add(g);
    this.wallRects[0].push({ x0: P.x0 - 0.2, x1: P.x1 + 0.2, z0: P.z0 - 0.2, z1: P.z1 + 0.2 });
    return g;
  }

  private rebuildNav() {
    this.rects = [[...this.wallRects[0], ...(this.hr ? this.hr.rects : [])], [...this.wallRects[1]]];
    this.navs.forEach((n, f) => n.rebuild(this.rects[f]));
    this.rectsVersion++;
  }

  // ---------- unlocks ----------

  private unlockName(u: HotelUnlock) {
    if (u.kind === 'room') return TR.hotel.unlock.room(ROOMS[u.index].number, ROOMS[u.index].suite);
    return TR.hotel.unlock[u.kind]();
  }

  /** Two tiles a floor (the upper floor's once it's built), and the upper floor itself at the lift. */
  private refreshTiles() {
    const open = (u: HotelUnlock) => !this.hs.unlocked.includes(u.id);
    const locked = [
      ...HOTEL_UNLOCKS.filter((u) => u.floor === 0 && open(u)).slice(0, 2),
      ...(open(UPPER_FLOOR) ? [UPPER_FLOOR] : []),
      ...(this.upperBuilt ? HOTEL_UNLOCKS.filter((u) => u.floor === 1 && open(u)).slice(0, 2) : []),
    ];
    this.tiles = this.tiles.filter((t) => {
      if (locked.some((u) => u.id === t.def.id)) return true;
      t.dispose();
      return false;
    });
    for (const u of locked) {
      if (this.tiles.some((t) => t.def.id === u.id)) continue;
      const def: TileDef = { id: u.id, cost: u.cost, x: u.x, z: u.z, label: this.unlockName(u) };
      this.tiles.push(new UnlockTile(def, this.hs.paid[u.id] ?? 0, this.group(u.floor)));
    }
  }

  private unlockDef(id: string) { return [...HOTEL_UNLOCKS, UPPER_FLOOR].find((x) => x.id === id)!; }

  private updateTiles(dt: number, p: THREE.Vector3) {
    for (const tile of [...this.tiles]) {
      tile.update(this.w.reduced ? 0 : this.w.time);
      const u = this.unlockDef(tile.def.id);
      const on = u.floor === this.playerFloor && dist2(p, tile.pos) < 0.95 * 0.95;
      if (!this.w.payTile(tile, on, dt, this.hs.paid)) continue;
      delete this.hs.paid[tile.def.id];
      tile.dispose();
      this.tiles = this.tiles.filter((t) => t !== tile);
      this.hs.unlocked.push(u.id);
      let obj: THREE.Object3D;
      if (u.kind === 'floor') {
        this.buildUpper();
        for (const i of UPPER_START) this.furnish(this.rooms[i]);
        obj = this.buildLift(0);
        // Bought standing on the pad: step off and back on to ride.
        this.liftLock = true;
      } else if (u.kind === 'room') obj = this.furnish(this.rooms[u.index]);
      else if (u.kind === 'desk') obj = this.addDesk();
      else if (u.kind === 'buffet') obj = this.addBuffet();
      else if (u.kind === 'spa') obj = this.addSpa();
      else obj = this.addTerraceBar();
      this.rebuildNav();
      this.w.celebrate(obj, this.toWorld(v(u.x, u.z)));
      const amenity = u.kind === 'buffet' || u.kind === 'spa' || u.kind === 'terrace';
      this.w.hud.toast(u.kind === 'floor' ? TR.hotel.floorOpened
        : amenity ? TR.hotel.amenity(this.unlockName(u), Math.round(AMENITY_BONUS[u.kind as keyof typeof AMENITY_BONUS] * 100))
        : TR.unlocked(this.unlockName(u)));
      this.refreshTiles();
      this.w.onBusinessProgress();
      this.persist();
      writeSave(this.w.data);
    }
  }

  // ---------- staff ----------

  hireCount(id: HireId) { return this.hs.hires[id] ?? 0; }
  lvl(id: UpgradeId) { return this.hs.upg[id] ?? 0; }

  upgradeValue(id: UpgradeId, lvl: number) {
    return id === 'sSpeed' ? BAL.staff.speed + BAL.staff.speedStep * lvl : BAL.staff.cap + BAL.staff.capStep * lvl;
  }

  get staffSpeed() { return this.upgradeValue('sSpeed', this.lvl('sSpeed')); }
  get staffCap() { return this.upgradeValue('sCap', this.lvl('sCap')); }

  buyUpgrade(id: UpgradeId) {
    const def = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.lvl(id);
    const cost = upgradeCost(def, lvl);
    if (lvl >= def.max || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    this.hs.upg[id] = lvl + 1;
    this.sfx.play('register', 1, 0);
    this.w.panel.render();
    writeSave(this.w.data);
  }

  hire(id: HireId, byManager = false) {
    const h = HOTEL_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    const cost = hireCost(h, n);
    if (n >= hireMax(h) || this.w.data.money < cost) return;
    this.w.data.money -= cost;
    this.hs.hires[id] = n + 1;
    this.spawnStaff(h, true);
    if (!byManager) this.sfx.play('unlock', 1, 0);
    if (!byManager) this.w.hud.toast(TR.hiredToast(TR.hire[id].name));
    else if (this.w.area === this) this.w.hud.toast(TR.managerHired(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  fire(id: HireId, byManager = false) {
    const h = HOTEL_HIRES.find((x) => x.id === id)!;
    const n = this.hireCount(id);
    if (!n) return;
    const s = this.staff.filter((x) => x.role === h.role && !x.leaving).pop();
    if (!s) return;
    s.dismiss(v(0, this.street));
    this.hs.hires[id] = n - 1;
    if (!byManager) this.w.hud.toast(TR.firedToast(TR.hire[id].name));
    else if (this.w.area === this) this.w.hud.toast(TR.managerFired(TR.hire[id].name));
    this.w.panel.render();
    writeSave(this.w.data);
  }

  private spawnStaff(h: HireDef, walkIn: boolean) {
    const i = this.staff.filter((s) => s.role === h.role).length;
    const home = h.role === 'receptionist' ? this.deskZone.clone()
      : h.role === 'manager' ? v(-8, 5.4) : v(-9.8 + (i % 5) * 0.8, -2.2 - Math.floor(i / 5) * 0.6);
    const from = walkIn ? v((Math.random() - 0.5) * 2, 8.8) : undefined;
    const s = new HotelStaff(h.role as 'receptionist' | 'housekeeper' | 'manager', home, this, from);
    this.staff.push(s);
    this.root.add(s.ch.root);
  }

  /**
   * With a manager the hotel staffs itself: a receptionist at the desk, another
   * housekeeper while rooms wait to be made up, one fewer when they stand idle.
   */
  private manage(dt: number) {
    if (!this.staff.some((s) => s.role === 'manager' && !s.leaving)) return;
    const m = this.mgr;
    m.t += dt;
    m.cool -= dt;
    if (m.t < 1) return;
    m.t = 0;
    const keepers = this.staff.filter((s) => s.role === 'housekeeper' && !s.leaving);
    const push = (a: number[], x: number) => { a.push(x); if (a.length > MANAGER_WINDOW) a.shift(); };
    push(m.dirty, this.rooms.filter((r) => r.dirty).length);
    push(m.idle, keepers.length ? keepers.filter((s) => !s.room).length / keepers.length : 0);
    if (m.cool > 0 || m.dirty.length < MANAGER_WINDOW / 2) return;
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const affordable = (id: HireId) => {
      const h = HOTEL_HIRES.find((x) => x.id === id)!;
      const n = this.hireCount(id);
      return n < hireMax(h) && this.w.data.money >= hireCost(h, n) + MANAGER_RESERVE;
    };
    const act = (fn: () => void) => { fn(); m.cool = MANAGER_COOLDOWN; m.dirty = []; m.idle = []; };
    if (!this.hireCount('receptionist') && affordable('receptionist')) return act(() => this.hire('receptionist', true));
    if (avg(m.dirty) >= 1.5 && avg(m.idle) < 0.3 && affordable('housekeeper')) return act(() => this.hire('housekeeper', true));
    if (avg(m.idle) > 0.6 && avg(m.dirty) < 0.3 && keepers.length > 1) return act(() => this.fire('housekeeper', true));
  }

  // ---------- guests ----------

  private roomPrice(r: Room) {
    return (r.def.suite ? ROOM_PRICE.suite : ROOM_PRICE.deluxe) * amenityMult(this.hs.unlocked);
  }

  /** Step into the lift: to the other floor. */
  ride(a: Rider) {
    a.floor = 1 - a.floor;
    a.pos.y = a.floor * H;
  }

  private slot(i: number) { return v(this.serve.x, this.serve.z + i * 0.95); }

  private spawnGuest() {
    const g = new Guest(this, v((Math.random() - 0.5) * 4, this.street));
    this.root.add(g.ch.root);
    this.guests.push(g);
    this.queue.push(g);
    g.goTo(this.nav, this.slot(this.queue.length - 1));
  }

  private leaveQueue(g: Guest) {
    const i = this.queue.indexOf(g);
    if (i < 0) return;
    this.queue.splice(i, 1);
    this.queue.forEach((q, j) => { if (j >= i) q.goTo(this.nav, this.slot(j)); });
  }

  /** Out of a room (down in the lift from upstairs), through the lobby to the street. */
  private exitRoute(from?: RoomDef): (THREE.Vector3 | 'lift')[] {
    const out = [v(0, 8.8), v((Math.random() - 0.5) * 4, this.street)];
    if (!from) return out;
    const door = v(from.door[0], from.door[1]);
    return from.floor ? [door, this.lift.clone(), 'lift', ...out] : [door, ...out];
  }

  gaveUp(g: Guest) {
    this.leaveQueue(g);
    const head = this.toWorld(g.pos.clone());
    head.y += 2.4;
    this.w.floats.spawn(head, TR.hotel.noRoom, 'angry');
    g.leave(this.exitRoute(), true);
  }

  checkOut(g: Guest) {
    const r = g.room!;
    r.guest = null;
    this.setDirty(r, true);
    g.leave(this.exitRoute(r.def));
  }

  private updateReception(dt: number, p: THREE.Vector3 | null) {
    this.playerAtDesk = !!p && this.playerFloor === 0 && dist2(p, this.deskZone) < 0.8 * 0.8;
    this.serveT -= dt;
    const g = this.queue[0];
    const present = this.playerAtDesk || !!this.receptionist?.atPost || !!this.cover?.atPost;
    if (!g || !g.arrived || !present || this.serveT > 0) return;
    const room = this.rooms.find((r) => r.unlocked && !r.dirty && !r.guest);
    if (!room) return;
    this.serveT = CHECKIN_TIME;
    room.guest = g;
    this.leaveQueue(g);
    g.checkIn(room);
    const tips = 1 + buffAmount(this.w.data.buffs, 'tips');
    const amount = Math.round(this.roomPrice(room) * tips * this.w.bonusMult() * this.share);
    this.w.sale(amount);
    const at = this.toWorld(this.serve.clone());
    at.y = 2.3;
    this.w.floats.spawn(at, `+${fmtMoney(amount)}`);
    this.sfx.play('register', 1, 150);
    this.served++;
  }

  /** Rooms get made up while someone stands in them; the towels must be there too. */
  private updateRooms(dt: number, p: THREE.Vector3 | null) {
    for (const r of this.rooms) {
      if (!r.dirty) continue;
      const playerHere = !!p && this.playerFloor === r.floor && dist2(p, r.zone) < 0.9 * 0.9;
      const here = playerHere
        || this.staff.some((s) => s.role !== 'receptionist' && !s.leaving && s.floor === r.floor && dist2(s.pos, r.zone) < 0.9 * 0.9);
      if (!here) continue;
      r.cleanT += dt;
      if (r.cleanT < CLEAN_TIME || !r.towel.count) continue;
      this.setDirty(r, false);
      if (playerHere) {
        this.sfx.play('unlock', 1.4, 0);
        const at = this.toWorld(r.zone.clone());
        at.y = r.floor * H + 2;
        this.w.floats.spawn(at, TR.hotel.roomReady);
      }
    }
  }

  // ---------- carrying ----------

  /** Towels from the laundry to rooms waiting to be made up, for the player and housekeeping. */
  interact(c: Carrier | HotelStaff, p: THREE.Vector3, floor = this.playerFloor) {
    if (c.cd > 0) return;
    const st = c.stack;
    const laundry = this.laundries[floor];
    if (laundry?.count && c.accepts.has('towel') && st.canAccept('towel') && dist2(p, this.laundryZone) < 0.9 * 0.9
      && (c.wants === undefined || c.wants === 'towel')) {
      transfer(laundry, st);
      c.cd = BAL.transferInterval * 2;
      if (c.isPlayer) this.sfx.play('pickup', 1 + st.count * 0.04);
      return;
    }
    if (st.kind !== 'towel') return;
    for (const r of this.rooms) {
      if (r.floor !== floor || !r.dirty || r.towel.count || dist2(p, r.zone) > 1.1 * 1.1) continue;
      transfer(st, r.towel);
      c.cd = BAL.transferInterval * 2;
      if (c.isPlayer) this.sfx.play('drop');
      return;
    }
  }

  deskAt(p: THREE.Vector3) {
    return this.hr && this.playerFloor === 0 && dist2(p, this.hr.zone) < 0.8 * 0.8 ? 'hr' as const : null;
  }

  get crowd() { return this.guests.filter((g) => g.state !== 'sleep').length; }

  incomePerSecond() {
    return hotelRate(this.rooms.filter((r) => r.unlocked).map((r) => r.def.index), this.hs.unlocked);
  }

  persist() {
    // A guest asleep when the game closes is gone by next time: their room needs making up.
    this.hs.dirty = this.rooms.filter((r) => r.dirty || r.guest).map((r) => r.def.index);
  }

  // ---------- frame ----------

  /** Standing on the lift pad a moment takes the player to the other floor (step off to ride again). */
  private updateLift(dt: number, p: THREE.Vector3 | null) {
    if (!p || !this.upperBuilt || dist2(p, this.lift) > 0.7 * 0.7) {
      this.liftHold = 0;
      this.liftLock = false;
      return;
    }
    if (this.liftLock) return;
    this.liftHold += dt;
    if (this.liftHold < 0.6) return;
    this.liftLock = true;
    this.playerFloor = 1 - this.playerFloor;
    this.w.player.pos.y = this.playerFloor * H;
    this.rectsVersion++;
    this.sfx.play('unlock', 1.8, 0);
    this.w.hud.toast(this.playerFloor ? TR.hotel.upstairs : TR.hotel.progress);
  }

  /**
   * Inside, show the player's floor (the upper one lifts away over the lobby);
   * from outside, the whole building with its top floor.
   */
  private updateView(here: boolean) {
    const view = here ? this.playerFloor : this.upperBuilt ? 1 : 0;
    this.upper.visible = view === 1;
    const D = HOTEL.halfD;
    for (const a of [...this.guests, ...this.staff]) a.ch.root.visible = a.floor === view || (a.floor === 0 && a.pos.z > D + 0.3);
  }

  update(dt: number, player: THREE.Vector3, here: boolean) {
    // Leaving the hotel (only possible downstairs) puts the player back at ground level.
    if (!here && this.playerFloor) {
      this.playerFloor = 0;
      this.w.player.pos.y = 0;
      this.rectsVersion++;
    }
    const p = here ? this.toLocal(player) : null;
    this.towelT -= dt;
    if (this.towelT <= 0) {
      this.towelT = TOWEL_EVERY;
      for (const pile of this.laundries) {
        if (!pile || pile.count >= TOWEL_TRAY) continue;
        const t = makeTowel();
        const from = new THREE.Vector3();
        pile.anchor.getWorldPosition(from);
        t.position.copy(from).add(new THREE.Vector3(0.5, -0.4, 0));
        this.w.scene.add(t);
        pile.receive(t, 'towel', 0.3);
      }
    }
    this.updateLift(dt, p);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const rooms = this.rooms.filter((r) => r.unlocked).length;
      this.spawnT = (Math.max(3, 12 - rooms * 1.1) * (0.8 + Math.random() * 0.4)) / this.w.events.footfall;
      if (this.queue.length < RECEPTION_QUEUE) this.spawnGuest();
    }
    for (const g of this.guests) g.update(dt);
    this.guests = this.guests.filter((g) => !g.dead);
    for (const s of this.staff) {
      s.update(dt);
      if (s.role !== 'receptionist' && !s.leaving && !s.atPost) this.interact(s, s.pos, s.floor);
    }
    for (const s of this.staff.filter((x) => x.gone)) s.ch.root.removeFromParent();
    this.staff = this.staff.filter((s) => !s.gone);
    this.updateReception(dt, p);
    this.updateRooms(dt, p);
    this.manage(dt);
    this.updateView(here);
    if (p) this.updateTiles(dt, p);
    this.persistT -= dt;
    if (this.persistT <= 0) {
      this.persistT = 1;
      this.persist();
    }
  }
}
