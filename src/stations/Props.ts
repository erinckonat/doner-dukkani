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

/** Walls, door gap and furniture of the boss's room, in shop-local metres. */
export const OFFICE_ROOM = { x0: -10, x1: -4.9, z0: 4.6, z1: 9, doorX0: -6.3 };
const ROOM = OFFICE_ROOM;
const LEATHER = '#6B3A22';

/**
 * A desk whose panel opens when you stand at its ring. The office desk sits in the
 * boss's room — low walls, a sofa, shelves, a rug — and its "ring" is the boss's
 * armchair behind the desk: sit down and the management panel opens.
 */
export class Desk {
  group = new THREE.Group();
  zone: THREE.Vector3;
  rects: Rect[];
  /** Where the boss sits (office only): position and facing. */
  seat: { pos: THREE.Vector3; yaw: number } | null = null;

  constructor([x, z]: [number, number], scene: THREE.Object3D, public kind: DeskKind) {
    const accent = kind === 'office' ? C.gold : C.primary;
    const g = this.group;
    g.position.set(x, 0, z);
    g.add(at(box(1.6, 0.08, 0.8, C.woodLight), 0, 0.76, 0));
    g.add(at(box(0.08, 0.72, 0.7, C.woodDark), -0.7, 0.36, 0));
    g.add(at(box(0.08, 0.72, 0.7, C.woodDark), 0.7, 0.36, 0));
    g.add(at(box(0.5, 0.03, 0.34, C.dark), 0.1, 0.815, 0.05));
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), mat(C.dark, C.gold, 0.3));
    screen.position.set(0.1, 0.98, 0.18);
    screen.rotation.x = 0.25;
    screen.rotation.y = Math.PI;
    g.add(screen);
    g.add(at(box(0.24, 0.3, 0.24, C.cream), -0.5, 0.95, 0));
    this.rects = [{ x0: x - 0.8, x1: x + 0.8, z0: z - 0.4, z1: z + 0.4 }];

    if (kind === 'office') {
      this.buildRoom(x, z);
      this.zone = this.seat!.pos.clone();
    } else {
      g.add(at(box(0.5, 0.08, 0.5, accent), 0, 0.46, 0.75));
      g.add(at(box(0.5, 0.6, 0.08, accent), 0, 0.75, 1.0));
      this.zone = new THREE.Vector3(x, 0, z - 1.05);
    }
    scene.add(g);

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
      const label = kind === 'office' ? TR.bossSeat : TR.hrDecal;
      ctx.fillText(label.toLocaleUpperCase('tr-TR'), 128, 196);
    }).tex;
    const decal = floorDecal(tex, 1.5);
    decal.position.set(this.zone.x, 0.02, this.zone.z);
    scene.add(decal);
  }

  /** The boss's room around the office desk at (x, z). Parts are added to the desk's group. */
  private buildRoom(x: number, z: number) {
    const g = this.group;
    const rel = (wx: number, wz: number) => [wx - x, wz - z] as const;
    const piece = (mesh: THREE.Mesh, wx: number, y: number, wz: number) => {
      const [rx, rz] = rel(wx, wz);
      g.add(at(mesh, rx, y, rz));
    };
    const r = ROOM;
    const wallH = 1.2;
    // Two low walls (the shop's own walls close the other sides); the gap is the door.
    piece(box(r.doorX0 - r.x0, wallH, 0.15, '#E9DCC6'), (r.x0 + r.doorX0) / 2, wallH / 2, r.z0);
    piece(box(0.15, wallH, r.z1 - r.z0, '#E9DCC6'), r.x1, wallH / 2, (r.z0 + r.z1) / 2);
    piece(box(r.doorX0 - r.x0 + 0.06, 0.06, 0.2, C.woodDark, false), (r.x0 + r.doorX0) / 2, wallH + 0.03, r.z0);
    piece(box(0.2, 0.06, r.z1 - r.z0 + 0.06, C.woodDark, false), r.x1, wallH + 0.03, (r.z0 + r.z1) / 2);
    this.rects.push(
      { x0: r.x0, x1: r.doorX0, z0: r.z0 - 0.08, z1: r.z0 + 0.08 },
      { x0: r.x1 - 0.08, x1: r.x1 + 0.08, z0: r.z0, z1: r.z1 },
    );

    // Rug under the desk and chair.
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), mat('#8E3B2E'));
    rug.rotation.x = -Math.PI / 2;
    piece(rug, x, 0.012, z + 0.5);

    // Boss's leather armchair behind the desk, facing it.
    const chairZ = z + 0.85;
    piece(box(0.7, 0.14, 0.62, LEATHER), x, 0.48, chairZ);
    piece(box(0.7, 0.8, 0.14, LEATHER), x, 0.85, chairZ + 0.3);
    piece(box(0.12, 0.3, 0.6, LEATHER), x - 0.38, 0.62, chairZ);
    piece(box(0.12, 0.3, 0.6, LEATHER), x + 0.38, 0.62, chairZ);
    piece(box(0.3, 0.4, 0.3, C.dark), x, 0.2, chairZ);
    this.seat = { pos: new THREE.Vector3(x, 0, chairZ - 0.05), yaw: Math.PI };

    // Sofa along the side wall, bookshelf against the inner wall, a plant in the corner.
    piece(box(0.8, 0.4, 1.8, LEATHER), r.x0 + 0.45, 0.2, 5.9);
    piece(box(0.25, 0.75, 1.8, LEATHER), r.x0 + 0.12, 0.55, 5.9);
    this.rects.push({ x0: r.x0, x1: r.x0 + 0.85, z0: 5.0, z1: 6.8 });
    piece(box(1.3, 1.5, 0.35, C.woodDark), -8.6, 0.75, r.z0 + 0.25);
    const bookColors = [C.primary, C.gold, '#3E6B5A', '#2F5D8C', C.cream];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        piece(box(0.18, 0.32, 0.26, bookColors[(i + row) % bookColors.length], false), -9.05 + i * 0.22, 0.32 + row * 0.45, r.z0 + 0.3);
      }
    }
    this.rects.push({ x0: -9.3, x1: -7.9, z0: r.z0, z1: r.z0 + 0.45 });
    piece(cyl(0.28, 0.2, 0.45, 8, C.terracotta), r.x1 - 0.5, 0.22, r.z1 - 0.55);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat(C.leaf));
    bush.castShadow = true;
    piece(bush, r.x1 - 0.5, 0.8, r.z1 - 0.55);
  }
}
