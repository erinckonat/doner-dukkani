import * as THREE from 'three';
import { STOP_Z, STOPS, type Stop } from '../config/transit';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture } from './Assets';
import { padRing } from './Neighborhood';

export interface StopPad { stop: Stop; pos: THREE.Vector3 }

/** A bus shelter at every stop: roof, glass back, a sign with the stop's name, and the ring to stand on. */
export function buildStops(scene: THREE.Scene) {
  const rects: Rect[] = [];
  const pads: StopPad[] = [];
  for (const s of STOPS) {
    const g = new THREE.Group();
    const sx = s.x + 2.4;
    g.add(at(box(2.6, 0.08, 1.2, '#2F5D8C'), sx, 2.3, STOP_Z));
    for (const x of [-1.2, 1.2]) g.add(at(box(0.08, 2.3, 0.08, '#3A3F4A'), sx + x, 1.15, STOP_Z - 0.5));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.04), new THREE.MeshStandardMaterial({ color: '#BFD6E0', transparent: true, opacity: 0.4, depthWrite: false }));
    glass.position.set(sx, 1.2, STOP_Z - 0.5);
    g.add(glass);
    g.add(at(box(2.0, 0.08, 0.4, C.woodLight), sx, 0.5, STOP_Z - 0.25));
    const sign = canvasTexture(512, 128, (ctx) => {
      ctx.fillStyle = '#2F5D8C';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = C.cream;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 56;
      do ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
      while (ctx.measureText(s.name).width > 480 && (size -= 4) > 28);
      ctx.fillText(s.name, 256, 68);
    }).tex;
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }));
    sm.position.set(sx, 2.0, STOP_Z - 0.46);
    g.add(sm);
    scene.add(g);
    rects.push({ x0: sx - 1.3, x1: sx + 1.3, z0: STOP_Z - 0.6, z1: STOP_Z - 0.1 });
    const pos = new THREE.Vector3(s.x, 0, STOP_Z);
    const ring = padRing(TR.bus.ring, '#2F5D8C');
    ring.position.set(pos.x, 0.03, pos.z);
    scene.add(ring);
    pads.push({ stop: s, pos });
  }
  return { rects, pads };
}
