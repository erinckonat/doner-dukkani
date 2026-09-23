import * as THREE from 'three';
import { BAL } from '../config/balance';
import type { Flyer } from '../core/Flyer';
import type { Rect } from '../core/Nav';
import { gridLayout, ItemStack } from '../systems/ItemStack';
import { at, box, C, cyl, makeDoner, mat } from '../world/Assets';
import { SPIT_ZONE_DZ } from '../world/layout';

/** Vertical rotisserie that keeps a tray of wrapped döner topped up. */
export class DonerSpit {
  group = new THREE.Group();
  tray: ItemStack;
  zone: THREE.Vector3;
  rect: Rect;
  private meat: THREE.Mesh;
  private spawn = new THREE.Object3D();
  private t = 0;

  constructor(x: number, z: number, private scene: THREE.Scene, flyer: Flyer) {
    const g = this.group;
    g.position.set(x, 0, z);
    g.add(at(box(1.5, 0.9, 1.1, C.steel), 0, 0.45, 0));
    g.add(at(box(1.54, 0.06, 1.14, C.steelDark), 0, 0.92, 0));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.14), mat('#7A3A22', C.gold, 0.55)), 0, 1.7, -0.46));
    g.add(at(cyl(0.03, 0.03, 1.7, 6, C.steelDark), 0, 1.75, 0));
    g.add(at(cyl(0.36, 0.36, 0.05, 10, C.steelDark), 0, 0.98, 0));
    this.meat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 1.05, 9, 3), mat(C.meat));
    this.meat.position.y = 1.55;
    this.meat.castShadow = true;
    g.add(this.meat);
    g.add(at(cyl(0.12, 0.2, 0.12, 8, C.meatDark), 0, 2.13, 0));
    g.add(at(box(1.4, 0.8, 0.5, '#8E867B'), 0, 0.4, 0.8));
    const trayAnchor = at(new THREE.Object3D(), 0, 0.8, 0.8);
    g.add(trayAnchor);
    this.spawn.position.set(0, 1.35, 0.4);
    g.add(this.spawn);
    scene.add(g);

    this.tray = new ItemStack(trayAnchor, flyer, () => BAL.spit.trayMax, gridLayout(2, 1, 0.42, 0));
    this.zone = new THREE.Vector3(x, 0, z + SPIT_ZONE_DZ);
    this.rect = { x0: x - 0.75, x1: x + 0.75, z0: z - 0.55, z1: z + 1.05 };
  }

  update(dt: number, interval: number) {
    this.meat.rotation.y += dt * 1.4;
    if (this.tray.isFull) return;
    this.t += dt;
    if (this.t < interval) return;
    this.t = 0;
    const d = makeDoner();
    this.spawn.getWorldPosition(d.position);
    this.scene.add(d);
    this.tray.receive(d, 'doner', 0.35);
  }
}
