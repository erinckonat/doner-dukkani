import * as THREE from 'three';
import { BAL } from '../config/balance';
import { MALL, type UnitDef } from '../config/mall';
import type { Mall } from '../Mall';
import type { Seat } from '../stations/Table';
import { box } from '../world/Assets';
import { Agent } from './Agent';
import { LOOKS, pick } from './Character';
import { makeAngryEmote } from './Emote';

/**
 * One step of a visit: walk somewhere (on the current floor), ride an escalator,
 * stand a moment, buy (a shop's till, a food stand), sit down to eat, or join the
 * cinema queue and wait for the showing.
 */
export type Step =
  | THREE.Vector3
  | { ride: 1 | -1 }
  | { wait: number }
  | { buy: UnitDef }
  | { eat: true }
  | { cinema: true };

const RIDE_SECS = 1.6;

/**
 * A shopper at the mall. Its visit is planned up front (see Mall.plan): a few shops,
 * perhaps lunch in the food court or a film, then home. Every purchase puts rent in
 * the office safe; shopping bags pile up in hand.
 */
export class MallVisitor extends Agent {
  floor = 0;
  dead = false;
  /** Waiting in the cinema queue, or inside for the film: the mall moves them. */
  atCinema = false;
  /** Riding an escalator: from, to and progress. */
  riding: { from: THREE.Vector3; to: THREE.Vector3; dir: 1 | -1; t: number } | null = null;
  private steps: Step[];
  private timer = 0;
  private bags = new THREE.Group();
  private tray: THREE.Object3D | null = null;
  private seat: Seat | null = null;
  /** Walking to a chair in the food court; sits once there. */
  private toSeat = false;
  private eating = false;
  private emote = makeAngryEmote(2.3);

  constructor(private m: Mall, steps: Step[], from: THREE.Vector3) {
    super({ shirt: pick(LOOKS.shirts), pants: pick(LOOKS.pants), skin: pick(LOOKS.skins), hair: pick(LOOKS.hair) });
    this.speed = BAL.customerSpeed * (0.85 + Math.random() * 0.3);
    this.steps = steps;
    this.bags.position.set(0.36, 0, 0);
    this.ch.root.add(this.bags);
    this.emote.visible = false;
    this.ch.root.add(this.emote);
    this.pos.copy(from);
    this.next();
  }

  get busy() { return this.eating || this.atCinema; }

  update(dt: number) {
    if (this.riding) return this.ride(dt);
    if (this.eating) {
      this.timer -= dt;
      if (this.timer <= 0) this.finishEating();
      return;
    }
    this.step(dt);
    if (this.atCinema) return;
    if (this.toSeat) {
      if (this.arrived) this.sit();
      return;
    }
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.next();
      return;
    }
    if (this.arrived) this.next();
  }

  /** Carry out steps until one takes time (a walk, a wait, a ride), or the visit is over. */
  next() {
    for (;;) {
      const s = this.steps.shift();
      if (!s) {
        this.dead = true;
        return;
      }
      if (s instanceof THREE.Vector3) {
        this.goTo(this.m.navFor(this.floor), s);
        return;
      }
      if ('ride' in s) {
        const r = this.m.escalatorPath(this.floor, s.ride);
        this.riding = { from: r.from, to: r.to, dir: s.ride, t: 0 };
        this.path = [];
        return;
      }
      if ('wait' in s) {
        this.timer = s.wait;
        this.path = [];
        return;
      }
      if ('buy' in s) {
        this.m.purchase(this, s.buy);
        if (s.buy.kind === 'food') this.holdTray();
        else this.addBag(s.buy.color);
        continue;
      }
      if ('eat' in s) {
        const seat = this.m.findSeat();
        if (!seat) {
          this.dropTray();
          continue;
        }
        seat.occupant = this;
        this.seat = seat;
        this.toSeat = true;
        this.goTo(this.m.navFor(this.floor), seat.pos.clone());
        return;
      }
      if ('cinema' in s) {
        if (this.m.joinCinema(this)) return;
        continue; // the queue is full: skip the film
      }
    }
  }

  /** At the chair: sit down, put the tray on the table, eat. */
  private sit() {
    const seat = this.seat!;
    this.toSeat = false;
    this.pos.set(seat.pos.x, this.floor * MALL.floorH, seat.pos.z);
    this.ch.setYaw(seat.yaw);
    this.ch.sitting = true;
    this.dropTray();
    this.eating = true;
    this.timer = 5 + Math.random() * 3;
  }

  /** Done eating: the tray stays on the table for someone to clear. */
  private finishEating() {
    const seat = this.seat!;
    this.eating = false;
    this.ch.sitting = false;
    this.m.leaveTray(seat);
    seat.occupant = null;
    this.seat = null;
    this.next();
  }

  private ride(dt: number) {
    const r = this.riding!;
    r.t = Math.min(1, r.t + dt / RIDE_SECS);
    this.pos.lerpVectors(r.from, r.to, r.t);
    this.ch.face(r.to.x - r.from.x, r.to.z - r.from.z, dt * 10);
    this.ch.animate(dt, 0);
    if (r.t < 1) return;
    this.floor += r.dir;
    this.riding = null;
    this.next();
  }

  /** Handed back by the cinema after the film (or a queue that gave up). */
  leaveCinema(angry = false) {
    this.atCinema = false;
    this.emote.visible = angry;
    this.next();
  }

  /** Walk towards a spot while held by the cinema. */
  walkTo(p: THREE.Vector3) { this.goTo(this.m.navFor(this.floor), p); }

  private addBag(color: string) {
    const n = this.bags.children.length;
    if (n >= 3) return;
    const bag = box(0.24, 0.3, 0.1, color, false);
    bag.position.set(0, 0.55 - n * 0.02, 0.05 - n * 0.12);
    this.bags.add(bag);
  }

  private holdTray() {
    const t = new THREE.Group();
    t.add(box(0.34, 0.03, 0.24, '#B5462B', false));
    const cup = box(0.07, 0.12, 0.07, '#F4EAD8', false);
    cup.position.set(0.1, 0.07, 0);
    t.add(cup);
    t.position.set(0, 0, 0.25);
    this.ch.hand.add(t);
    this.ch.carrying = true;
    this.tray = t;
  }

  private dropTray() {
    this.tray?.removeFromParent();
    this.tray = null;
    this.ch.carrying = false;
  }
}
