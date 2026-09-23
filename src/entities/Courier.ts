import * as THREE from 'three';
import type { Game } from '../Game';
import type { Counter } from '../stations/Counter';
import { ItemStack } from '../systems/ItemStack';
import { at, box, C, cyl, mat } from '../world/Assets';
import { COURIER_LANE_Z, COURIER_PARK_X } from '../world/layout';
import { Agent } from './Agent';
import { LOOKS, pick } from './Character';
import { OrderBubble } from './OrderBubble';

const ROAD_START = -42;
const ROAD_END = 42;
const RIDE_SPEED = 11;
const ANGRY_AFTER = 25;

export const COURIER_COLOR = '#3E7C6B';

export type CourierState = 'arriving' | 'queue' | 'toBike' | 'leaving';

function makeScooter() {
  const bike = new THREE.Group();
  const wheels: THREE.Group[] = [];
  for (const x of [-0.55, 0.55]) {
    const w = new THREE.Group();
    const tyre = cyl(0.27, 0.27, 0.12, 12, C.dark);
    tyre.rotation.x = Math.PI / 2;
    const hub = cyl(0.1, 0.1, 0.14, 8, C.steel);
    hub.rotation.x = Math.PI / 2;
    w.add(tyre, hub);
    w.position.set(x, 0.27, 0);
    bike.add(w);
    wheels.push(w);
  }
  bike.add(at(box(1.0, 0.26, 0.34, COURIER_COLOR), 0, 0.52, 0));
  bike.add(at(box(0.55, 0.1, 0.32, C.dark), -0.12, 0.72, 0));
  const fork = box(0.08, 0.66, 0.1, C.steelDark);
  fork.position.set(0.52, 0.68, 0);
  fork.rotation.z = -0.3;
  bike.add(fork, at(box(0.06, 0.06, 0.62, C.dark), 0.62, 1.0, 0));
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.16), mat(C.cream, C.gold, 0.8));
  light.position.set(0.68, 0.86, 0);
  bike.add(light);
  bike.add(at(box(0.46, 0.44, 0.46, COURIER_COLOR), -0.52, 1.02, 0), at(box(0.47, 0.06, 0.47, C.cream, false), -0.52, 1.1, 0));
  return { bike, wheels };
}

/** Delivery rider: rides in, queues at the counter like a customer, rides off to deliver the order. */
export class Courier extends Agent {
  state: CourierState = 'arriving';
  stack: ItemStack;
  got = 0;
  waitT = 0;
  dead = false;
  private bike: THREE.Group;
  private wheels: THREE.Group[];
  private bikeV = RIDE_SPEED;
  private bubble = new OrderBubble(COURIER_COLOR);

  constructor(private g: Game, private counter: Counter, public want: number) {
    super({ shirt: COURIER_COLOR, pants: C.dark, skin: pick(LOOKS.skins), hat: 'cap', hatColor: COURIER_COLOR });
    this.speed = 2.8;
    // Insulated delivery bag on the back.
    this.ch.model.add(at(box(0.42, 0.42, 0.3, COURIER_COLOR), 0, 1.05, -0.36), at(box(0.43, 0.05, 0.31, C.cream, false), 0, 1.2, -0.36));
    this.stack = new ItemStack(this.ch.hand, g.flyer, () => 99);

    const { bike, wheels } = makeScooter();
    this.bike = bike;
    this.wheels = wheels;
    bike.position.set(ROAD_START, 0, COURIER_LANE_Z);
    g.scene.add(bike);
    this.mount();

    this.bubble.sprite.position.y = 2.35;
    this.ch.root.add(this.bubble.sprite);
  }

  private mount() {
    this.bike.add(this.ch.root);
    this.ch.root.position.set(-0.1, 0.22, 0);
    this.ch.setYaw(Math.PI / 2);
    this.ch.sitting = true;
    this.ch.animate(0, 0);
  }

  private ride(dt: number) {
    this.bike.position.x += this.bikeV * dt;
    for (const w of this.wheels) w.rotation.z -= (this.bikeV * dt) / 0.27;
  }

  update(dt: number) {
    switch (this.state) {
      case 'arriving': {
        // Ease into the parking spot.
        const left = COURIER_PARK_X - this.bike.position.x;
        this.bikeV = Math.max(1.5, Math.min(RIDE_SPEED, left * 1.2));
        this.ride(dt);
        if (this.bike.position.x >= COURIER_PARK_X) {
          this.bike.position.x = COURIER_PARK_X;
          this.g.scene.attach(this.ch.root);
          this.ch.sitting = false;
          this.pos.set(COURIER_PARK_X, 0, COURIER_LANE_Z - 0.8);
          this.pos.y = 0;
          this.ch.root.rotation.set(0, 0, 0);
          this.ch.setYaw(Math.PI);
          // Join the back of the counter queue.
          const k = this.counter;
          k.queue.push(this);
          this.goTo(this.g.nav, k.slot(k.queue.length - 1));
          this.state = 'queue';
        }
        break;
      }
      case 'queue': {
        this.step(dt);
        this.ch.carrying = this.stack.count > 0;
        const front = this.counter.queue[0] === this;
        if (this.arrived) {
          const [dx, dz] = this.counter.def.dir;
          this.ch.face(-dx, -dz, dt);
          if (front) this.waitT += dt;
        }
        if (front && this.arrived) this.bubble.show(this.want - this.got, this.waitT > ANGRY_AFTER);
        else this.bubble.hide();
        break;
      }
      case 'toBike':
        this.step(dt);
        this.ch.carrying = this.stack.count > 0;
        if (this.arrived) {
          this.stack.clear(); // into the insulated bag
          this.ch.carrying = false;
          this.mount();
          this.bikeV = 2;
          this.g.sfx.play('moto', 1, 0);
          this.state = 'leaving';
        }
        break;
      case 'leaving':
        this.bikeV = Math.min(RIDE_SPEED, this.bikeV + dt * 6);
        this.ride(dt);
        if (this.bike.position.x > ROAD_END) {
          this.bike.removeFromParent();
          this.bubble.dispose();
          this.dead = true;
          this.g.onlineDelivered(this);
        }
        break;
    }
  }

  /** Called by the game when the whole order has been handed over. */
  collected() {
    this.bubble.hide();
    this.state = 'toBike';
    this.goTo(this.g.nav, new THREE.Vector3(COURIER_PARK_X, 0, COURIER_LANE_Z - 0.8));
  }
}
