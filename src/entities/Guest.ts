import * as THREE from 'three';
import { BAL } from '../config/balance';
import { STAY } from '../config/hotel';
import type { Hotel, Room } from '../Hotel';
import { box } from '../world/Assets';
import { Agent } from './Agent';
import { LOOKS, pick } from './Character';
import { makeAngryEmote } from './Emote';

/** Guests dress up a little: darker, smarter colours than the street crowd. */
const SMART = ['#2E3A55', '#4A3B52', '#3E6B5A', '#6B2E2E', '#3A3F4A', '#8A6A4A', '#E9E4DA'];

/**
 * A hotel guest: queues at reception with a suitcase, is given a room, sleeps
 * the night in the bed, and leaves the room to be made up.
 */
export class Guest extends Agent {
  state: 'queue' | 'toRoom' | 'sleep' | 'leaving' = 'queue';
  room: Room | null = null;
  waitT = 0;
  dead = false;
  private route: THREE.Vector3[] = [];
  private timer = 0;
  private emote = makeAngryEmote(2.3);
  private suitcase = new THREE.Group();

  constructor(private h: Hotel, from: THREE.Vector3) {
    super({ shirt: pick(SMART), pants: pick(LOOKS.pants), skin: pick(LOOKS.skins), hair: pick(LOOKS.hair) });
    this.speed = BAL.customerSpeed * (0.9 + Math.random() * 0.2);
    // Suitcase on wheels, pulled along at the side.
    const colour = pick(['#2F5D8C', '#C8412B', '#3A332E', '#E3A64A']);
    this.suitcase.add(box(0.36, 0.5, 0.2, colour, false));
    this.suitcase.children[0].position.y = 0.3;
    this.suitcase.add(box(0.04, 0.3, 0.04, '#3A332E', false));
    this.suitcase.children[1].position.set(0, 0.7, 0);
    this.suitcase.position.set(0.42, 0, -0.1);
    this.ch.root.add(this.suitcase);
    this.emote.visible = false;
    this.ch.root.add(this.emote);
    this.pos.copy(from);
  }

  update(dt: number) {
    if (this.state !== 'sleep') this.step(dt);
    switch (this.state) {
      case 'queue':
        if (this.arrived) {
          this.ch.face(0, -1, dt);
          this.waitT += dt;
        }
        this.emote.visible = this.waitT > BAL.angryAfter;
        if (this.waitT > BAL.giveUpAfter) this.h.gaveUp(this);
        break;
      case 'toRoom':
      case 'leaving':
        if (!this.arrived) break;
        if (this.route.length) {
          this.goTo(this.h.nav, this.route.shift()!);
          break;
        }
        if (this.state === 'toRoom') this.lieDown();
        else {
          this.ch.root.removeFromParent();
          this.dead = true;
        }
        break;
      case 'sleep':
        this.timer -= dt;
        if (this.timer <= 0) this.getUp();
        break;
    }
  }

  checkIn(room: Room) {
    this.room = room;
    this.state = 'toRoom';
    this.emote.visible = false;
    const [dx, dz] = room.def.door;
    const [zx, zz] = room.def.zone;
    this.route = [new THREE.Vector3(zx, 0, zz)];
    this.goTo(this.h.nav, new THREE.Vector3(dx, 0, dz));
  }

  /** Into bed: flat on the back, head on the pillow. */
  private lieDown() {
    const d = this.room!.def;
    const r = this.ch.root;
    const foot = d.yaw === 0 ? 0.85 : -0.85;
    this.pos.set(d.bed[0], 0.62, d.bed[1] + foot);
    r.rotation.order = 'YXZ';
    this.ch.setYaw(d.yaw);
    r.rotation.x = -Math.PI / 2;
    this.suitcase.visible = false;
    this.ch.animate(0, 0);
    this.state = 'sleep';
    this.timer = (d.suite ? STAY.suite : STAY.deluxe) * (0.9 + Math.random() * 0.2);
  }

  private getUp() {
    const d = this.room!.def;
    const r = this.ch.root;
    r.rotation.x = 0;
    r.rotation.order = 'XYZ';
    this.pos.set(d.zone[0], 0, d.zone[1]);
    this.suitcase.visible = true;
    this.h.checkOut(this);
    this.room = null;
  }

  leave(route: THREE.Vector3[], angry = false) {
    this.state = 'leaving';
    this.emote.visible = angry;
    this.route = route.slice(1);
    this.goTo(this.h.nav, route[0]);
  }
}
