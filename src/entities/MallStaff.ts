import * as THREE from 'three';
import { MALL } from '../config/mall';
import type { Mall } from '../Mall';
import type { Table } from '../stations/Table';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { C } from '../world/Assets';
import { Agent, dist2 } from './Agent';
import { LOOKS, pick } from './Character';

export type MallRole = 'accountant' | 'cleaner' | 'usher';

/**
 * Mall staff, each on their own floor: the accountant keeps the office safe (and
 * empties it into the account), cleaners clear the food court's tables, the usher
 * stands at the cinema doors and starts the showings.
 */
export class MallStaff extends Agent {
  stack: ItemStack;
  accepts = new Set<ItemKind>(['trash']);
  cd = 0;
  isPlayer = false;
  wants: ItemKind | null = null;
  atPost = false;
  leaving = false;
  gone = false;
  floor: number;
  private table: Table | null = null;
  private think = 0;

  constructor(public role: MallRole, private home: THREE.Vector3, private m: Mall) {
    super(role === 'accountant'
      ? { shirt: '#2E3A55', pants: '#232833', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), collar: '#F4F1EA', tie: C.gold }
      : role === 'usher'
        ? { shirt: '#6B2E2E', pants: '#2A1E18', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), collar: '#F4F1EA', tie: C.gold }
        : { shirt: '#5E8C7A', pants: '#3A3F4A', skin: pick(LOOKS.skins), hair: pick(LOOKS.hair), hat: 'cap', hatColor: '#3E6B5A', apron: C.cream });
    this.floor = role === 'accountant' ? 0 : 2;
    this.stack = new ItemStack(this.ch.hand, m.flyer, () => m.staffCap);
    this.pos.set(home.x, this.floor * MALL.floorH, home.z);
  }

  update(dt: number) {
    this.speed = this.m.staffSpeed;
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
    if (this.role !== 'cleaner') {
      this.atPost = this.moveTo(this.m.navFor(this.floor), this.home);
      if (this.atPost) this.ch.face(0, this.role === 'usher' ? -1 : 1, 1);
      return;
    }
    this.thinkCleaner();
  }

  /** Clear the nearest dirty table while there's room in hand, then the bin. */
  private thinkCleaner() {
    const nav = this.m.navFor(this.floor);
    if (!this.stack.isFull) {
      const claimed = new Set(this.m.staff.filter((s) => s !== this).map((s) => s.table));
      const dirty = this.m.tables.filter((t) => t.dirty && !claimed.has(t));
      const t = dirty.length ? dirty.reduce((a, b) => (dist2(b.center, this.pos) < dist2(a.center, this.pos) ? b : a)) : null;
      if (t) {
        this.table = t;
        this.wants = 'trash';
        this.moveTo(nav, t.access);
        return;
      }
    }
    this.table = null;
    this.wants = null;
    if (this.stack.count) this.moveTo(nav, this.m.bin!.zone);
    else this.moveTo(nav, this.home);
  }

  /** Let go: drop what's in hand and walk off to the escalator. */
  dismiss() {
    this.leaving = true;
    this.atPost = false;
    this.stack.clear();
    const [x, z] = MALL.downPad;
    this.goTo(this.m.navFor(this.floor), new THREE.Vector3(x, 0, z));
  }
}
