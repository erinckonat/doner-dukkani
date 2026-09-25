import * as THREE from 'three';
import type { CarStyle } from '../config/cars';
import { at, box, C, cyl, mat } from './Assets';

/** Body proportions per style: length, width, body height, cabin height, cabin length and offset, ride height. */
const SHAPE: Record<CarStyle, { l: number; w: number; bh: number; ch: number; cl: number; cz: number; ride: number }> = {
  classic: { l: 3.9, w: 1.65, bh: 0.55, ch: 0.5, cl: 1.8, cz: -0.1, ride: 0.3 },
  hatch: { l: 3.4, w: 1.7, bh: 0.55, ch: 0.55, cl: 1.8, cz: -0.35, ride: 0.3 },
  sedan: { l: 4.1, w: 1.75, bh: 0.55, ch: 0.5, cl: 1.9, cz: -0.15, ride: 0.3 },
  suv: { l: 4.0, w: 1.85, bh: 0.75, ch: 0.6, cl: 2.2, cz: -0.25, ride: 0.42 },
  sport: { l: 4.0, w: 1.85, bh: 0.42, ch: 0.38, cl: 1.5, cz: -0.35, ride: 0.24 },
};

/**
 * A low-poly car facing +z: body, cabin with glass, lamps and four wheels.
 * Returns the group and its wheels (to spin while driving).
 */
export function makeCarModel(style: CarStyle, paint: string) {
  const s = SHAPE[style];
  const root = new THREE.Group();
  const y0 = s.ride + s.bh / 2;
  root.add(at(box(s.w, s.bh, s.l, paint), 0, y0, 0));
  root.add(at(box(s.w - 0.2, s.ch, s.cl, paint), 0, s.ride + s.bh + s.ch / 2, s.cz));
  const glass = mat('#2F3A44', '#7FA7C0', 0.15);
  const pane = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glass);
    m.position.set(x, y, z);
    root.add(m);
  };
  const gy = s.ride + s.bh + s.ch / 2;
  pane(s.w - 0.28, s.ch - 0.12, 0.04, 0, gy, s.cz + s.cl / 2 + 0.01);
  pane(s.w - 0.28, s.ch - 0.12, 0.04, 0, gy, s.cz - s.cl / 2 - 0.01);
  for (const x of [-1, 1]) pane(0.04, s.ch - 0.14, s.cl - 0.3, x * ((s.w - 0.2) / 2 + 0.01), gy, s.cz);
  for (const x of [-1, 1]) {
    root.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.04), mat(C.cream, C.gold, 0.7)), x * (s.w / 2 - 0.35), y0 + 0.05, s.l / 2 + 0.01));
    root.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.04), mat(C.primary, C.primary, 0.5)), x * (s.w / 2 - 0.35), y0 + 0.05, -s.l / 2 - 0.01));
  }
  if (style === 'classic') root.add(at(box(s.w + 0.04, 0.1, 0.12, C.steel, false), 0, s.ride + 0.12, s.l / 2));
  if (style === 'sport') root.add(at(box(s.w - 0.2, 0.06, 0.4, C.dark, false), 0, s.ride + s.bh + 0.2, -s.l / 2 + 0.2));
  const wheels: THREE.Object3D[] = [];
  const r = style === 'suv' ? 0.4 : 0.33;
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Group();
    const tyre = cyl(r, r, 0.24, 12, C.dark);
    tyre.rotation.z = Math.PI / 2;
    w.add(tyre, at(cyl(r * 0.5, r * 0.5, 0.26, 8, C.steel, false), 0, 0, 0));
    (w.children[1] as THREE.Mesh).rotation.z = Math.PI / 2;
    w.position.set(x * (s.w / 2 - 0.05), r, z * (s.l / 2 - 0.65));
    root.add(w);
    wheels.push(w);
  }
  return { root, wheels, length: s.l };
}
