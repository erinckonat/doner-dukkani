import * as THREE from 'three';
import { at, box, C, mat } from '../world/Assets';

export interface DoorOpts {
  /** Centre of the doorway and its width, in the parent's frame; the wall runs along x. */
  x: number;
  z: number;
  width: number;
  height: number;
  /**
   * slide: glass leaves part to the sides (shop fronts, the market, the hotel lobby).
   * swing: wooden leaf on hinges (offices, rooms); `double` hangs one on each side.
   */
  style: 'slide' | 'swing';
  /** Swing: which side it opens into (+1: towards +z). */
  into?: 1 | -1;
  double?: boolean;
  /** Leaf colour (swing) or frame colour (slide). */
  color: string;
  /** Floor this doorway is on, for buildings with more than one. */
  floor?: number;
}

const GLASS = new THREE.MeshStandardMaterial({ color: '#CFE3EA', transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false });
/** Swung-open leaves stop just short of the wall. */
const SWING = Math.PI * 0.47;

/**
 * A door in a wall gap that opens when anyone comes near and closes behind them.
 * Purely a set piece: it never blocks anyone, so paths and collisions stay as they are.
 */
export class Door {
  group = new THREE.Group();
  floor: number;
  /** 0 shut … 1 fully open. */
  private k = 0;
  private leaves: { obj: THREE.Object3D; shut: number; open: number }[] = [];

  constructor(parent: THREE.Object3D, private o: DoorOpts) {
    this.floor = o.floor ?? 0;
    const g = this.group;
    g.position.set(o.x, 0, o.z);
    const w = o.width;
    const h = o.height;
    if (o.style === 'slide') {
      // Frame: two posts and a header; two glass leaves that part to the sides.
      for (const s of [-1, 1]) g.add(at(box(0.08, h, 0.14, o.color), (s * w) / 2, h / 2, 0));
      g.add(at(box(w + 0.08, 0.12, 0.16, o.color), 0, h - 0.06, 0));
      for (const s of [-1, 1]) {
        const leaf = new THREE.Group();
        const pane = new THREE.Mesh(new THREE.BoxGeometry(w / 2, h - 0.16, 0.04), GLASS);
        pane.renderOrder = 2;
        leaf.add(at(pane, 0, (h - 0.16) / 2 + 0.02, 0));
        // A metal edge on the meeting side and a push bar, so the glass reads as a door.
        leaf.add(at(box(0.04, h - 0.16, 0.06, o.color, false), (-s * w) / 4 + s * 0.02, (h - 0.16) / 2 + 0.02, 0));
        leaf.add(at(box(w / 2 - 0.2, 0.05, 0.07, C.steel, false), 0, Math.min(1, h * 0.5), 0));
        leaf.position.set((s * w) / 4, 0, 0.04 * s);
        g.add(leaf);
        this.leaves.push({ obj: leaf, shut: (s * w) / 4, open: (s * w) / 4 + (s * w) / 2 * 0.92 });
      }
    } else {
      const sides: (-1 | 1)[] = o.double ? [-1, 1] : [-1];
      const leafW = o.double ? w / 2 : w;
      const into = o.into ?? 1;
      for (const s of sides) {
        // Hinged at the jamb on side `s`; the leaf reaches across the gap.
        const hinge = new THREE.Group();
        hinge.position.set((s * w) / 2, 0, 0);
        const leaf = box(leafW - 0.04, h - 0.04, 0.06, o.color);
        hinge.add(at(leaf, (-s * leafW) / 2, (h - 0.04) / 2, 0));
        // Recessed panel and a brass handle near the free edge, on both faces.
        hinge.add(at(box(leafW * 0.6, h * 0.5, 0.075, shade(o.color), false), (-s * leafW) / 2, h * 0.55, 0));
        for (const f of [-1, 1]) hinge.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(C.gold)), -s * (leafW - 0.14), Math.min(0.95, h * 0.55), f * 0.06));
        g.add(hinge);
        // Rotating about y turns the leaf towards ±z; the sign depends on the hinge side.
        this.leaves.push({ obj: hinge, shut: 0, open: -into * s * -SWING });
      }
    }
    parent.add(g);
  }

  /** Whether anyone in `points` (same frame as the door, on its floor) is close enough to open it. */
  sense(points: Iterable<{ x: number; z: number }>) {
    const hx = this.o.width / 2 + 0.6;
    for (const p of points) {
      if (Math.abs(p.x - this.o.x) < hx && Math.abs(p.z - this.o.z) < 1.5) return true;
    }
    return false;
  }

  update(dt: number, open: boolean, reduced: boolean) {
    const target = open ? 1 : 0;
    // Opens briskly, closes a little slower.
    this.k = reduced ? target : this.k + (target - this.k) * (1 - Math.exp(-dt * (open ? 12 : 6)));
    for (const l of this.leaves) {
      const v = l.shut + (l.open - l.shut) * this.k;
      if (this.o.style === 'slide') l.obj.position.x = v;
      else l.obj.rotation.y = v;
    }
  }
}

/** A slightly darker tone of a hex colour, for the door's inset panel. */
function shade(hex: string) {
  return `#${new THREE.Color(hex).multiplyScalar(0.82).getHexString()}`;
}
