import type { Flyer } from '../core/Flyer';
import type { Rect } from '../core/Nav';
import { ItemStack, type ItemKind } from '../systems/ItemStack';
import { CITY } from '../world/layout';
import { Character } from './Character';

const R = 0.32;

export class Player {
  /** The boss: navy suit, white shirt, red tie — not kitchen whites. */
  ch = new Character({ shirt: '#2E3A55', pants: '#232833', skin: '#E0AC80', hair: '#2A1E18', collar: '#F4F1EA', tie: '#C8412B' });
  stack: ItemStack;
  /** The player can carry any product or grocery (one kind at a time) and trash. */
  accepts = new Set<ItemKind>(['doner', 'burger', 'fries', 'shake', 'trash', 'bread', 'milk', 'eggs', 'pasta', 'oil', 'detergent', 'towel']);
  cd = 0;
  isPlayer = true;
  moving = false;

  constructor(flyer: Flyer, cap: () => number) {
    this.stack = new ItemStack(this.ch.hand, flyer, cap);
  }

  get pos() { return this.ch.root.position; }

  update(dt: number, move: { x: number; z: number }, speed: number, rects: Rect[]) {
    this.cd -= dt;
    const p = this.pos;
    p.x += move.x * speed * dt;
    p.z += move.z * speed * dt;
    for (let it = 0; it < 2; it++) {
      for (const r of rects) {
        const cx = Math.max(r.x0, Math.min(p.x, r.x1));
        const cz = Math.max(r.z0, Math.min(p.z, r.z1));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x += (dx / d) * (R - d);
          p.z += (dz / d) * (R - d);
        } else {
          // Centre is inside the rect: push out through the nearest edge.
          const opts = [[p.x - r.x0 + R, -1, 0], [r.x1 - p.x + R, 1, 0], [p.z - r.z0 + R, 0, -1], [r.z1 - p.z + R, 0, 1]];
          opts.sort((a, b) => a[0] - b[0]);
          const [amt, sx, sz] = opts[0];
          p.x += sx * amt;
          p.z += sz * amt;
        }
      }
    }
    p.x = Math.max(CITY.minX + R, Math.min(CITY.maxX - R, p.x));
    p.z = Math.max(CITY.minZ + R, Math.min(CITY.maxZ - R, p.z));

    const mag = Math.hypot(move.x, move.z);
    this.moving = mag > 0;
    this.ch.face(move.x, move.z, dt);
    this.ch.carrying = this.stack.count > 0;
    this.ch.animate(dt, mag * speed);
  }
}
