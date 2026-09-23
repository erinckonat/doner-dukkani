import * as THREE from 'three';
import type { Nav } from '../core/Nav';
import { Character, type Look } from './Character';

/** A character that walks along A* paths. */
export class Agent {
  ch: Character;
  path: THREE.Vector3[] = [];
  speed = 2.5;

  constructor(look: Look) {
    this.ch = new Character(look);
  }

  get pos() { return this.ch.root.position; }
  get arrived() { return this.path.length === 0; }

  goTo(nav: Nav, target: THREE.Vector3) {
    this.path = nav.find(this.pos, target);
  }

  /** Path to target unless already there or already heading there. Returns true when there. */
  moveTo(nav: Nav, t: THREE.Vector3) {
    if (dist2(this.pos, t) < 0.03) {
      this.path = [];
      return true;
    }
    const last = this.path[this.path.length - 1];
    if (!last || dist2(last, t) > 0.03) this.goTo(nav, t);
    return false;
  }

  step(dt: number) {
    let rem = this.speed * dt;
    const moving = this.path.length > 0;
    while (rem > 1e-6 && this.path.length) {
      const t = this.path[0];
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) this.ch.face(dx, dz, dt);
      if (d <= rem) {
        this.pos.x = t.x;
        this.pos.z = t.z;
        rem -= d;
        this.path.shift();
      } else {
        this.pos.x += (dx / d) * rem;
        this.pos.z += (dz / d) * rem;
        rem = 0;
      }
    }
    this.ch.animate(dt, moving ? this.speed : 0);
  }
}

export const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
