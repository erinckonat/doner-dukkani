import * as THREE from 'three';
import { BAL } from '../config/balance';
import type { Flyer } from '../core/Flyer';
import type { Nav, Rect } from '../core/Nav';
import type { Staff } from '../entities/Staff';
import { gridLayout, ItemStack } from '../systems/ItemStack';
import { at, box, C, mat, zoneDecal } from '../world/Assets';
import { DRIVE_ROAD } from '../world/layout';

/** Anyone who queues at a counter: walk-in customers and couriers. */
export interface QueueMember {
  readonly arrived: boolean;
  got: number;
  want: number;
  stack: ItemStack;
  goTo(nav: Nav, t: THREE.Vector3): void;
}

type P = [number, number];

export interface CounterDef {
  x: number; z: number; len: number; depth: number; rotY: number;
  drop: P; cashier: P; serve: P; dir: P; spawn: P;
  maxQueue: number; dine: boolean; stockX: number; regX: number; awning?: boolean;
  /** Distance between queue spots (people ~1 m, cars ~3.4 m). */
  slotGap?: number;
  /** Served to cars on the drive-thru road rather than people on foot. */
  drive?: boolean;
}

export const MAIN_COUNTER: CounterDef = {
  x: -3, z: -2, len: 4, depth: 1, rotY: 0,
  drop: [-4.2, -3.25], cashier: [-2.3, -3.25], serve: [-2.3, -0.8], dir: [0, 1],
  spawn: [0.5, 13.5], maxQueue: 7, dine: true, stockX: -1.2, regX: 0.7,
};

export const WINDOW_COUNTER: CounterDef = {
  x: -10, z: 3, len: 2, depth: 0.8, rotY: Math.PI / 2,
  drop: [-8.95, 3.55], cashier: [-8.95, 2.5], serve: [DRIVE_ROAD.laneX, 3], dir: [0, -1],
  spawn: [DRIVE_ROAD.laneX, DRIVE_ROAD.z0], maxQueue: 4, dine: false, stockX: -0.45, regX: 0.5,
  awning: true, slotGap: 3.4, drive: true,
};

const v = ([x, z]: P) => new THREE.Vector3(x, 0, z);

/** Serving counter: stock on top, a register and a customer queue. */
export class Counter {
  group = new THREE.Group();
  stock: ItemStack;
  queue: QueueMember[] = [];
  dropZone: THREE.Vector3;
  cashierZone: THREE.Vector3;
  servePoint: THREE.Vector3;
  spawn: THREE.Vector3;
  rect: Rect;
  staffCashier: Staff | null = null;
  playerHere = false;
  serveT = 0;

  constructor(public def: CounterDef, scene: THREE.Scene, flyer: Flyer) {
    const g = this.group;
    g.position.set(def.x, 0, def.z);
    g.rotation.y = def.rotY;
    g.add(at(box(def.len, 1.0, def.depth - 0.1, C.wood), 0, 0.5, 0));
    g.add(at(box(def.len + 0.1, 0.08, def.depth, '#F1E4CC'), 0, 1.04, 0));
    g.add(at(box(def.len - 0.2, 0.12, 0.02, C.primary, false), 0, 0.72, def.depth / 2 - 0.04));
    g.add(at(box(0.5, 0.28, 0.4, C.dark), def.regX, 1.22, 0));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.03), mat('#3A2A22', C.gold, 0.4));
    screen.position.set(def.regX, 1.46, -0.12);
    screen.rotation.x = -0.4;
    g.add(screen);
    if (def.awning) {
      for (let i = 0; i < 5; i++) {
        const s = box(0.4, 0.06, 1.1, i % 2 ? C.cream : C.primary);
        // Local -z faces outward (the street side) for the window counter.
        s.position.set(-0.8 + i * 0.4, 1.95, -0.9);
        s.rotation.x = -0.35;
        g.add(s);
      }
    }
    const stockAnchor = at(new THREE.Object3D(), def.stockX, 1.08, 0);
    g.add(stockAnchor);
    scene.add(g);

    this.stock = new ItemStack(stockAnchor, flyer, () => BAL.counterMax, gridLayout(2, 2, 0.42, 0.26));
    this.dropZone = v(def.drop);
    this.cashierZone = v(def.cashier);
    this.servePoint = v(def.serve);
    this.spawn = v(def.spawn);
    for (const [kind, p] of [['drop', this.dropZone], ['register', this.cashierZone]] as const) {
      const d = zoneDecal(kind);
      d.position.set(p.x, 0.02, p.z);
      scene.add(d);
    }
    const hl = def.len / 2;
    const hd = def.depth / 2;
    this.rect = def.rotY === 0
      ? { x0: def.x - hl, x1: def.x + hl, z0: def.z - hd, z1: def.z + hd }
      : { x0: def.x - hd, x1: def.x + hd, z0: def.z - hl, z1: def.z + hl };
  }

  slot(i: number) {
    const [dx, dz] = this.def.dir;
    const gap = this.def.slotGap ?? 0.95;
    return new THREE.Vector3(this.servePoint.x + dx * i * gap, 0, this.servePoint.z + dz * i * gap);
  }

  get cashierPresent() {
    return this.playerHere || (this.staffCashier?.atPost ?? false);
  }
}
