import * as THREE from 'three';
import type { Hotel, Room } from '../Hotel';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { C } from '../world/Assets';
import { Agent, dist2 } from './Agent';
import { LOOKS, pick } from './Character';

/**
 * Hotel staff. The receptionist holds the front desk. Housekeepers make up rooms
 * guests have left: fresh towels from the laundry, then the bed. The manager
 * stands in at reception when there's a queue and nobody at the desk, and
 * otherwise helps housekeeping.
 */
export class HotelStaff extends Agent {
  stack: ItemStack;
  accepts = new Set<ItemKind>(['towel']);
  cd = 0;
  isPlayer = false;
  wants: ItemKind | null = null;
  atPost = false;
  leaving = false;
  gone = false;
  /** The room this housekeeper is making up. */
  room: Room | null = null;
  /** 0 downstairs, 1 upstairs. */
  floor = 0;
  private think = 0;

  constructor(public role: 'receptionist' | 'housekeeper' | 'manager', private home: THREE.Vector3, private h: Hotel, from?: THREE.Vector3) {
    super(role === 'manager'
      ? { shirt: '#8FA6BF', pants: '#3A3F4A', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), tie: C.gold }
      : role === 'receptionist'
        ? { shirt: '#2E3A55', pants: '#232833', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), collar: '#F4F1EA', tie: C.gold }
        : { shirt: '#E9E4DA', pants: '#3A3F4A', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), apron: '#2E3A55' });
    this.stack = new ItemStack(this.ch.hand, h.flyer, () => h.staffCap);
    this.pos.copy(from ?? home);
  }

  update(dt: number) {
    this.speed = this.h.staffSpeed;
    this.cd -= dt;
    this.step(dt);
    this.ch.carrying = this.stack.count > 0;
    if (this.leaving) {
      if (this.arrived) this.gone = true;
      return;
    }
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.25;
    if (this.role === 'receptionist') {
      this.atPost = this.goOn(0, this.h.deskZone);
      if (this.atPost) this.ch.face(0, 1, 1);
      return;
    }
    if (this.role === 'manager' && this.cover()) return;
    this.atPost = false;
    this.housekeep();
  }

  /** Walk to `target` on `floor`, by way of the lift if on the other floor. True once there. */
  private goOn(floor: number, target: THREE.Vector3) {
    if (this.floor !== floor) {
      if (this.moveTo(this.h.navFor(this.floor), this.h.lift)) this.h.ride(this);
      return false;
    }
    return this.moveTo(this.h.navFor(floor), target);
  }

  dismiss(exit: THREE.Vector3) {
    this.leaving = true;
    this.atPost = false;
    this.wants = null;
    this.room = null;
    this.stack.clear();
    if (this.h.cover === this) this.h.cover = null;
    // Upstairs staff leave by the lift, then walk out.
    if (this.floor) this.h.ride(this);
    this.goTo(this.h.nav, exit);
  }

  /** Manager: stand in at reception while guests wait and nobody's there. */
  private cover() {
    const h = this.h;
    const need = !this.stack.count && h.queue.length > 0 && !h.playerAtDesk && !h.receptionist?.atPost && (!h.cover || h.cover === this);
    if (!need) {
      if (h.cover === this) h.cover = null;
      return false;
    }
    h.cover = this;
    this.room = null;
    this.wants = null;
    this.atPost = this.goOn(0, h.deskZone);
    if (this.atPost) this.ch.face(0, 1, 1);
    return true;
  }

  private housekeep() {
    const h = this.h;
    const mates = h.staff.filter((s) => s !== this && !s.leaving);
    if (this.room && !this.room.dirty) this.room = null;
    if (!this.room) {
      const claimed = new Set(mates.map((s) => s.room));
      const open = h.rooms.filter((r) => r.dirty && !claimed.has(r));
      // Nearest first; a room on the other floor counts as a long walk.
      const cost = (r: Room) => dist2(r.zone, this.pos) + (r.floor === this.floor ? 0 : 400);
      this.room = open.length ? open.reduce((a, b) => (cost(b) < cost(a) ? b : a)) : null;
    }
    const r = this.room;
    if (!r) {
      this.wants = null;
      this.goOn(0, this.home);
      return;
    }
    // Towels first (from this floor's linen, enough for the rooms waiting), then the room.
    const pile = h.laundries[this.floor];
    const towelsNeeded = h.rooms.filter((x) => x.dirty && !x.towel.count).length;
    const loading = this.wants === 'towel' && !!pile?.count && this.stack.count < Math.min(towelsNeeded, h.staffCap);
    if (pile && ((!r.towel.count && !this.stack.count) || (loading && dist2(this.pos, h.laundryZone) < 0.2))) {
      this.wants = 'towel';
      this.moveTo(h.navFor(this.floor), h.laundryZone);
      return;
    }
    this.wants = null;
    this.goOn(r.floor, r.zone);
  }
}
