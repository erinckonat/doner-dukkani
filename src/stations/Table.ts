import * as THREE from 'three';
import type { Flyer } from '../core/Flyer';
import type { Rect } from '../core/Nav';
import { columnLayout, gridLayout, ItemStack } from '../systems/ItemStack';
import { at, box, C, cyl } from '../world/Assets';

export interface Seat {
  pos: THREE.Vector3;
  yaw: number;
  occupant: object | null;
  plate: ItemStack;
  table: Table;
}

/** Round table with two chairs. Blocks new diners while trash is on it. */
export class Table {
  group = new THREE.Group();
  seats: Seat[] = [];
  trash: ItemStack;
  center: THREE.Vector3;
  access: THREE.Vector3;
  rect: Rect;

  constructor(x: number, z: number, scene: THREE.Scene, flyer: Flyer, chair: string = C.primary, chairDark: string = C.primaryDark) {
    const g = this.group;
    g.position.set(x, 0, z);
    g.add(at(cyl(0.62, 0.62, 0.08, 8, C.woodLight), 0, 0.78, 0));
    g.add(at(cyl(0.07, 0.07, 0.74, 6, C.woodDark), 0, 0.37, 0));
    g.add(at(cyl(0.3, 0.3, 0.04, 8, C.woodDark), 0, 0.02, 0));
    for (const side of [-1, 1]) {
      const cx = side * 0.95;
      g.add(at(box(0.5, 0.08, 0.5, chair), cx, 0.45, 0));
      g.add(at(box(0.36, 0.41, 0.36, chairDark), cx, 0.2, 0));
      g.add(at(box(0.08, 0.55, 0.5, chair), cx + side * 0.22, 0.75, 0));
      const plateAnchor = at(new THREE.Object3D(), side * 0.3, 0.82, 0);
      g.add(plateAnchor);
      this.seats.push({
        pos: new THREE.Vector3(x + cx, 0, z),
        yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        occupant: null,
        plate: new ItemStack(plateAnchor, flyer, () => 10, columnLayout, true),
        table: this,
      });
    }
    const trashAnchor = at(new THREE.Object3D(), 0, 0.82, 0);
    g.add(trashAnchor);
    scene.add(g);

    this.trash = new ItemStack(trashAnchor, flyer, () => 99, gridLayout(2, 2, 0.22, 0.22));
    this.center = new THREE.Vector3(x, 0, z);
    this.access = new THREE.Vector3(x, 0, z + 1.25);
    this.rect = { x0: x - 0.62, x1: x + 0.62, z0: z - 0.62, z1: z + 0.62 };
  }

  get dirty() { return this.trash.count > 0; }

  freeSeat() {
    if (this.dirty) return null;
    return this.seats.find((s) => !s.occupant) ?? null;
  }
}
