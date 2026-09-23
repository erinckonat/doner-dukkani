import * as THREE from 'three';
import { PRODUCTS, type ProductKind } from '../config/balance';
import type { Flyer } from '../core/Flyer';
import type { Rect } from '../core/Nav';
import { gridLayout, ItemStack } from '../systems/ItemStack';
import { at, box, C, cyl, makeProduct, mat } from '../world/Assets';
import { SPIT_ZONE_DZ } from '../world/layout';

/** The machine body for each product; returns a part to animate, if any. */
function buildMachine(kind: ProductKind, g: THREE.Group): THREE.Object3D | null {
  switch (kind) {
    case 'doner': {
      g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.14), mat('#7A3A22', C.gold, 0.55)), 0, 1.7, -0.46));
      g.add(at(cyl(0.03, 0.03, 1.7, 6, C.steelDark), 0, 1.75, 0));
      g.add(at(cyl(0.36, 0.36, 0.05, 10, C.steelDark), 0, 0.98, 0));
      const meat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 1.05, 9, 3), mat(C.meat));
      meat.position.y = 1.55;
      meat.castShadow = true;
      g.add(meat, at(cyl(0.12, 0.2, 0.12, 8, C.meatDark), 0, 2.13, 0));
      return meat;
    }
    case 'burger': {
      // Flat-top grill with a hood; patties sizzle on the plate.
      g.add(at(box(1.4, 0.06, 0.9, C.dark), 0, 0.96, 0));
      g.add(at(box(1.46, 0.7, 0.12, C.steelDark), 0, 1.3, -0.44));
      g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.1), mat('#7A3A22', C.gold, 0.5)), 0, 1.02, -0.3));
      const patties = new THREE.Group();
      for (const [x, z] of [[-0.4, -0.1], [0, 0.1], [0.4, -0.1], [-0.2, 0.25], [0.25, 0.25]]) {
        patties.add(at(cyl(0.14, 0.14, 0.05, 9, '#6A3319'), x, 1.02, z));
      }
      g.add(patties);
      return patties;
    }
    case 'fries': {
      // Twin-basket fryer: hot oil wells with baskets hanging above.
      g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.7), mat('#C98B2B', C.gold, 0.45)), 0, 0.93, -0.05));
      const baskets = new THREE.Group();
      for (const x of [-0.3, 0.3]) {
        baskets.add(at(box(0.42, 0.22, 0.4, '#3A332E'), x, 1.1, -0.05));
        baskets.add(at(box(0.06, 0.04, 0.4, C.steel), x, 1.24, 0.2));
      }
      g.add(baskets);
      g.add(at(box(1.46, 0.5, 0.12, C.steelDark), 0, 1.2, -0.46));
      return baskets;
    }
    case 'shake': {
      // Twin-spindle mixer on a cream cabinet, a cup under each head.
      g.add(at(box(1.2, 1.2, 0.35, '#F4B6C2'), 0, 1.5, -0.35));
      g.add(at(box(1.24, 0.1, 0.39, C.cream), 0, 2.12, -0.35));
      const heads = new THREE.Group();
      for (const x of [-0.3, 0.3]) {
        heads.add(at(box(0.26, 0.22, 0.34, C.cream), x, 1.72, -0.05));
        heads.add(at(cyl(0.02, 0.02, 0.3, 6, C.steel), x, 1.47, 0.02));
        heads.add(at(cyl(0.1, 0.08, 0.22, 10, C.steel), x, 1.08, 0.02));
      }
      g.add(heads);
      return heads;
    }
  }
}

/** A kitchen machine that keeps a tray of its product topped up. */
export class Producer {
  group = new THREE.Group();
  tray: ItemStack;
  zone: THREE.Vector3;
  rect: Rect;
  private moving: THREE.Object3D | null;
  private spawn = new THREE.Object3D();
  private t = 0;
  private time = Math.random() * 10;

  /** Built into `root` (the shop); finished items start life in the world `scene`. */
  constructor(x: number, z: number, public product: ProductKind, root: THREE.Object3D, private scene: THREE.Scene, flyer: Flyer, rotY = 0) {
    const g = this.group;
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.add(at(box(1.5, 0.9, 1.1, C.steel), 0, 0.45, 0));
    g.add(at(box(1.54, 0.06, 1.14, C.steelDark), 0, 0.92, 0));
    this.moving = buildMachine(product, g);
    g.add(at(box(1.4, 0.8, 0.5, '#8E867B'), 0, 0.4, 0.8));
    const trayAnchor = at(new THREE.Object3D(), 0, 0.8, 0.8);
    g.add(trayAnchor);
    this.spawn.position.set(0, 1.35, 0.4);
    g.add(this.spawn);
    root.add(g);

    const def = PRODUCTS[product];
    this.tray = new ItemStack(trayAnchor, flyer, () => def.trayMax, gridLayout(2, 1, 0.42, 0));
    // The machine faces local +z: its pickup spot is out in front, its footprint turns with it.
    const fwd = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
    this.zone = new THREE.Vector3(x, 0, z).addScaledVector(fwd, SPIT_ZONE_DZ);
    const facingZ = Math.abs(fwd.z) > 0.5;
    const [back, front, half] = [0.55, 1.05, 0.75];
    this.rect = facingZ
      ? { x0: x - half, x1: x + half, z0: z - (fwd.z > 0 ? back : front), z1: z + (fwd.z > 0 ? front : back) }
      : { x0: x - (fwd.x > 0 ? back : front), x1: x + (fwd.x > 0 ? front : back), z0: z - half, z1: z + half };
  }

  update(dt: number) {
    this.time += dt;
    const m = this.moving;
    if (m) {
      if (this.product === 'doner') m.rotation.y += dt * 1.4;
      else if (this.product === 'burger') m.position.y = Math.abs(Math.sin(this.time * 9)) * 0.008;
      else if (this.product === 'fries') m.position.y = Math.sin(this.time * 2) * 0.03;
      else m.rotation.y = Math.sin(this.time * 30) * 0.01;
    }
    if (this.tray.isFull) return;
    this.t += dt;
    if (this.t < PRODUCTS[this.product].interval) return;
    this.t = 0;
    const item = makeProduct(this.product);
    this.spawn.getWorldPosition(item.position);
    this.scene.add(item);
    this.tray.receive(item, this.product, 0.35);
  }
}
