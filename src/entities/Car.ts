import * as THREE from 'three';
import { BAL } from '../config/balance';
import type { Nav } from '../core/Nav';
import type { Shop } from '../Shop';
import type { Counter, QueueMember } from '../stations/Counter';
import { ItemStack } from '../systems/ItemStack';
import { orderTotal, remaining, type Order } from '../systems/Order';
import { at, box, C, cyl, mat } from '../world/Assets';
import { CITY, DRIVE_ROAD } from '../world/layout';
import { LOOKS, pick } from './Character';
import { makeAngryEmote } from './Emote';
import { OrderBubble } from './OrderBubble';

const PAINT = ['#B8473A', '#3F6E8C', '#E0B04A', '#5E8C5A', '#D9D2C5', '#4A4550', '#8C5A7A'];
const TOP_SPEED = 9;

export type CarState = 'queue' | 'leaving' | 'street';

/** How far along the high street (local x) a departing car drives before it's gone. */
const STREET_END = 70;

/**
 * Drive-thru customer. Drives along the side road heading +z, so the driver's
 * (left-hand) window faces the shop's takeaway window at +x, then turns onto the
 * high street and drives off.
 */
export class Car implements QueueMember {
  root = new THREE.Group();
  stack: ItemStack;
  state: CarState = 'queue';
  got: Order = {};
  waitT = 0;
  dead = false;
  private targetZ: number;
  private v = TOP_SPEED;
  private wheels: THREE.Object3D[] = [];
  private window = new THREE.Object3D();
  private bubble = new OrderBubble();
  private emote = makeAngryEmote(2.4);

  constructor(private counter: Counter, private shop: Shop, public order: Order) {
    const paint = pick(PAINT);
    const r = this.root;
    r.add(at(box(1.7, 0.55, 3.2, paint), 0, 0.55, 0));
    r.add(at(box(1.5, 0.5, 1.7, paint), 0, 1.07, -0.15));
    // Glass: windscreen, rear screen, side windows (driver's side left open).
    const glass = mat('#2F3A44', '#7FA7C0', 0.15);
    const pane = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glass);
      m.position.set(x, y, z);
      r.add(m);
    };
    pane(1.42, 0.38, 0.04, 0, 1.08, 0.71);
    pane(1.42, 0.36, 0.04, 0, 1.08, -1.01);
    pane(0.04, 0.36, 1.5, -0.76, 1.08, -0.15);
    pane(0.04, 0.36, 0.7, 0.76, 1.08, -0.55);
    for (const x of [-0.5, 0.5]) {
      r.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.04), mat(C.cream, C.gold, 0.7)), x, 0.62, 1.61));
      r.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), mat(C.primary, C.primary, 0.5)), x, 0.62, -1.61));
    }
    for (const [x, z] of [[-0.82, 1.0], [0.82, 1.0], [-0.82, -1.0], [0.82, -1.0]]) {
      const w = new THREE.Group();
      const tyre = cyl(0.32, 0.32, 0.22, 12, C.dark);
      tyre.rotation.z = Math.PI / 2;
      w.add(tyre);
      w.position.set(x, 0.32, z);
      r.add(w);
      this.wheels.push(w);
    }
    // Driver behind the open window.
    const skin = pick(LOOKS.skins);
    r.add(at(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), mat(skin)), 0.38, 0.98, 0.05));
    r.add(at(new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 1), mat(pick(LOOKS.hair))), 0.38, 1.05, 0.02));
    this.window.position.set(0.9, 1.05, 0.05);
    r.add(this.window);
    this.bubble.sprite.position.set(0.4, 2.2, 0);
    r.add(this.bubble.sprite, this.emote);

    this.stack = new ItemStack(this.window, shop.flyer, () => 99, undefined, true);
    r.position.set(DRIVE_ROAD.laneX, 0, DRIVE_ROAD.z0);
    this.targetZ = r.position.z;
    shop.root.add(r);
  }

  get pos() { return this.root.position; }
  get arrived() { return this.state === 'queue' && Math.abs(this.root.position.z - this.targetZ) < 0.05; }

  goTo(_nav: Nav, t: THREE.Vector3) {
    this.targetZ = t.z;
  }

  /** Move forward along the way the car is facing. */
  private drive(dt: number, speed: number) {
    const d = speed * dt;
    if (this.state === 'street') this.root.position.x += d;
    else this.root.position.z += d;
    for (const w of this.wheels) w.rotation.x += d / 0.32;
  }

  update(dt: number) {
    // Döner that reached the window go into the car.
    for (const item of this.stack.items) if (item.parent === this.window) item.visible = false;
    if (this.state === 'queue') {
      const left = this.targetZ - this.root.position.z;
      if (left > 0.001) this.drive(dt, Math.min(left / dt, Math.max(1, Math.min(TOP_SPEED, left * 1.6))));
      const front = this.counter.queue[0] === this && this.arrived;
      if (this.arrived) this.waitT += dt;
      const angry = this.waitT > BAL.angryAfter;
      if (front) this.bubble.show(remaining(this.order, this.got), angry);
      else this.bubble.hide();
      this.emote.visible = angry && !front;
      if (this.waitT > BAL.giveUpAfter && orderTotal(this.got) === 0) this.giveUp();
      return;
    }
    this.v = Math.min(TOP_SPEED, this.v + dt * 5);
    this.drive(dt, this.v);
    // At the high street, turn right into the near lane.
    if (this.state === 'leaving' && this.root.position.z >= CITY.road.northLane) {
      this.root.position.z = CITY.road.northLane;
      this.root.rotation.y = Math.PI / 2;
      this.state = 'street';
    }
    if (this.state === 'street' && this.root.position.x > STREET_END) {
      this.stack.clear();
      this.bubble.dispose();
      this.root.removeFromParent();
      this.dead = true;
    }
  }

  /** Fed up with the queue: pull out and drive off without buying. */
  private giveUp() {
    const head = new THREE.Vector3();
    this.root.getWorldPosition(head);
    head.y = 2.6;
    this.shop.gaveUp(this, head);
    this.bubble.hide();
    this.emote.visible = true;
    this.state = 'leaving';
    this.v = 1;
  }

  /** Order complete: pull away down the road. */
  served() {
    this.bubble.hide();
    this.emote.visible = false;
    this.state = 'leaving';
    this.v = 1;
  }
}
