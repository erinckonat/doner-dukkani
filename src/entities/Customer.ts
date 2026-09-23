import * as THREE from 'three';
import { BAL } from '../config/balance';
import type { Game } from '../Game';
import type { Counter } from '../stations/Counter';
import type { Seat } from '../stations/Table';
import { ItemStack, transfer } from '../systems/ItemStack';
import { remaining, type Order } from '../systems/Order';
import { makeTrash } from '../world/Assets';
import { WAIT_SPOT } from '../world/layout';
import { Agent } from './Agent';
import { LOOKS, pick } from './Character';
import { OrderBubble } from './OrderBubble';

export type CustomerState = 'queue' | 'toSeat' | 'eating' | 'waitSeat' | 'leaving';

export class Customer extends Agent {
  state: CustomerState = 'queue';
  stack: ItemStack;
  got: Order = {};
  waitT = 0;
  dead = false;
  private seat: Seat | null = null;
  private timer = 0;
  private bubble = new OrderBubble();

  constructor(public counter: Counter, private g: Game, public order: Order) {
    super({ shirt: pick(LOOKS.shirts), pants: pick(LOOKS.pants), skin: pick(LOOKS.skins), hair: pick(LOOKS.hair) });
    this.speed = BAL.customerSpeed * (0.9 + Math.random() * 0.2);
    this.stack = new ItemStack(this.ch.hand, g.flyer, () => 99, undefined, true);
    this.bubble.sprite.position.y = 2.35;
    this.ch.root.add(this.bubble.sprite);
  }

  update(dt: number) {
    this.step(dt);
    this.ch.carrying = this.stack.count > 0 && !this.ch.sitting;
    const g = this.g;
    switch (this.state) {
      case 'queue': {
        const front = this.counter.queue[0] === this;
        if (this.arrived) {
          const [dx, dz] = this.counter.def.dir;
          this.ch.face(-dx, -dz, dt);
          if (front) this.waitT += dt;
        }
        if (front && this.arrived) this.bubble.show(remaining(this.order, this.got), this.waitT > BAL.angryAfter);
        else this.bubble.hide();
        break;
      }
      case 'waitSeat': {
        this.waitT += dt;
        this.timer -= dt;
        if (this.timer > 0) break;
        this.timer = 0.5;
        const seat = g.findSeat();
        if (seat) this.goSeat(seat);
        else if (this.waitT > BAL.seatWaitTimeout) this.leave();
        break;
      }
      case 'toSeat':
        if (this.arrived) this.sit();
        break;
      case 'eating':
        this.timer -= dt;
        if (this.timer <= 0) this.finishEating();
        break;
      case 'leaving':
        if (this.arrived) {
          this.stack.clear();
          this.ch.root.removeFromParent();
          this.bubble.dispose();
          this.dead = true;
        }
        break;
    }
  }

  /** Called by the game when the order is complete. */
  served(dine: boolean) {
    this.bubble.hide();
    this.waitT = 0;
    if (!dine) return this.leave();
    const seat = this.g.findSeat();
    if (seat) return this.goSeat(seat);
    this.state = 'waitSeat';
    this.timer = 0.5;
    const t = new THREE.Vector3(WAIT_SPOT[0] + (Math.random() - 0.5) * 2, 0, WAIT_SPOT[1] + (Math.random() - 0.5) * 1.5);
    this.goTo(this.g.nav, t);
  }

  private goSeat(seat: Seat) {
    seat.occupant = this;
    this.seat = seat;
    this.state = 'toSeat';
    this.goTo(this.g.nav, seat.pos);
  }

  private sit() {
    const seat = this.seat!;
    this.pos.set(seat.pos.x, 0, seat.pos.z);
    this.ch.setYaw(seat.yaw);
    this.ch.sitting = true;
    while (this.stack.count) transfer(this.stack, seat.plate, 0.3);
    this.timer = BAL.eatTime * (0.85 + Math.random() * 0.3);
    this.state = 'eating';
  }

  private finishEating() {
    const seat = this.seat!;
    const from = new THREE.Vector3();
    seat.plate.anchor.getWorldPosition(from);
    // A tray's worth of wrappers, cups and boxes: at most three pieces per diner.
    const n = Math.min(3, seat.plate.clear());
    for (let i = 0; i < n; i++) {
      const t = makeTrash();
      t.position.copy(from);
      this.g.scene.add(t);
      seat.table.trash.receive(t, 'trash', 0.25 + i * 0.05);
    }
    seat.occupant = null;
    this.seat = null;
    this.ch.sitting = false;
    this.leave();
  }

  leave() {
    this.state = 'leaving';
    const s = this.counter.spawn;
    this.goTo(this.g.nav, new THREE.Vector3(s.x + (Math.random() - 0.5) * 3, 0, s.z));
  }
}
