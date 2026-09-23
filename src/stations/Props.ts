import * as THREE from 'three';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, cyl, floorDecal, mat } from '../world/Assets';

export class TrashBin {
  group = new THREE.Group();
  anchor = new THREE.Object3D();
  pos: THREE.Vector3;
  zone: THREE.Vector3;
  rect: Rect;

  constructor([x, z]: [number, number], scene: THREE.Object3D) {
    this.group.position.set(x, 0, z);
    this.group.add(at(cyl(0.36, 0.3, 0.85, 8, '#5B6B4E'), 0, 0.43, 0));
    this.group.add(at(cyl(0.4, 0.4, 0.06, 8, '#46543C'), 0, 0.88, 0));
    this.group.add(at(box(0.3, 0.05, 0.02, C.cream, false), 0, 0.55, 0.36));
    this.anchor.position.set(0, 0.95, 0);
    this.group.add(this.anchor);
    scene.add(this.group);
    this.pos = new THREE.Vector3(x, 0, z);
    this.zone = new THREE.Vector3(x - 0.9, 0, z);
    this.rect = { x0: x - 0.4, x1: x + 0.4, z0: z - 0.4, z1: z + 0.4 };
  }
}

export type DeskKind = 'office' | 'hr';

/** A desk with a floor ring in front; standing on the ring opens its panel. */
export class Desk {
  group = new THREE.Group();
  zone: THREE.Vector3;
  rect: Rect;

  constructor([x, z]: [number, number], scene: THREE.Object3D, public kind: DeskKind) {
    const accent = kind === 'office' ? C.gold : C.primary;
    const g = this.group;
    g.position.set(x, 0, z);
    g.add(at(box(1.6, 0.08, 0.8, C.woodLight), 0, 0.76, 0));
    g.add(at(box(0.08, 0.72, 0.7, C.woodDark), -0.7, 0.36, 0));
    g.add(at(box(0.08, 0.72, 0.7, C.woodDark), 0.7, 0.36, 0));
    g.add(at(box(0.5, 0.03, 0.34, C.dark), 0.1, 0.815, 0.05));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), mat(C.dark, C.gold, 0.3));
    screen.position.set(0.1, 0.98, -0.12);
    screen.rotation.x = -0.25;
    g.add(screen);
    g.add(at(box(0.24, 0.3, 0.24, C.cream), -0.5, 0.95, 0));
    g.add(at(box(0.5, 0.08, 0.5, accent), 0, 0.46, 0.75));
    g.add(at(box(0.5, 0.6, 0.08, accent), 0, 0.75, 1.0));
    scene.add(g);

    this.zone = new THREE.Vector3(x, 0, z - 1.05);
    this.rect = { x0: x - 0.8, x1: x + 0.8, z0: z - 0.4, z1: z + 0.4 };

    const tex = canvasTexture(256, 256, (ctx) => {
      ctx.lineWidth = 10;
      ctx.strokeStyle = C.gold;
      ctx.beginPath();
      ctx.arc(128, 128, 110, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(227,166,74,0.18)';
      ctx.fill();
      ctx.strokeStyle = C.primary;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (kind === 'office') {
        // Up arrow: upgrades.
        ctx.moveTo(88, 120); ctx.lineTo(128, 80); ctx.lineTo(168, 120);
        ctx.moveTo(128, 80); ctx.lineTo(128, 150);
      } else {
        // Person with a plus: hiring.
        ctx.arc(116, 92, 20, 0, Math.PI * 2);
        ctx.moveTo(80, 152); ctx.quadraticCurveTo(116, 108, 152, 152);
        ctx.moveTo(172, 88); ctx.lineTo(172, 124);
        ctx.moveTo(154, 106); ctx.lineTo(190, 106);
      }
      ctx.stroke();
      ctx.fillStyle = C.dark;
      ctx.font = '800 30px "Baloo 2", sans-serif';
      ctx.textAlign = 'center';
      const label = kind === 'office' ? TR.panelTitle : TR.hrDecal;
      ctx.fillText(label.toLocaleUpperCase('tr-TR'), 128, 196);
    }).tex;
    const decal = floorDecal(tex, 1.5);
    decal.position.set(this.zone.x, 0.02, this.zone.z);
    scene.add(decal);
  }
}
