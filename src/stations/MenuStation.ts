import * as THREE from 'three';
import { MENU_PARTS, PRODUCTS, type ProductKind } from '../config/balance';
import type { Flyer } from '../core/Flyer';
import { gridLayout, ItemStack } from '../systems/ItemStack';
import { at, makeProduct, zoneDecal } from '../world/Assets';
import { Producer } from './Producer';

/** Parts of each kind the counter holds while waiting to pack them. */
export const MENU_INPUT_CAP = 4;

/**
 * The burger shop's menu counter. Bring it burgers, fries and shakes; whenever it has
 * one of each it packs them into a menu box on its tray, which goes to the till like
 * any other product. Hand it parts and pick up boxes at the same spot.
 */
export class MenuStation extends Producer {
  /** One pile per part along the counter top. */
  inputs = new Map<ProductKind, ItemStack>();

  constructor(x: number, z: number, root: THREE.Object3D, scene: THREE.Scene, flyer: Flyer, rotY: number) {
    super(x, z, 'menu', root, scene, flyer, rotY);
    MENU_PARTS.forEach((kind, i) => {
      const anchor = at(new THREE.Object3D(), -0.45 + i * 0.45, 0.95, 0.05);
      this.group.add(anchor);
      this.inputs.set(kind, new ItemStack(anchor, flyer, () => MENU_INPUT_CAP, gridLayout(1, 2, 0, 0.2)));
    });
    // A floor ring with the menu box on it, like the till's drop spot: stand here.
    const decal = zoneDecal('drop', 'menu');
    decal.position.set(this.zone.x, 0.02, this.zone.z);
    root.add(decal);
  }

  /** Whether it can take one more of `kind` right now. */
  wants(kind: ProductKind) { return !!this.inputs.get(kind)?.canAccept(kind); }

  /** A box is ready, or one of each part is waiting to be packed. */
  get ready() { return this.tray.count > 0 || this.canPack; }

  private get canPack() { return MENU_PARTS.every((k) => this.inputs.get(k)!.count > 0); }

  override update(dt: number) {
    if (this.tray.isFull || !this.canPack) {
      this.t = 0;
      return;
    }
    this.t += dt;
    if (this.t < PRODUCTS.menu.interval) return;
    this.t = 0;
    for (const k of MENU_PARTS) this.inputs.get(k)!.take()?.removeFromParent();
    const box = makeProduct('menu');
    this.spawn.getWorldPosition(box.position);
    this.scene.add(box);
    this.tray.receive(box, 'menu', 0.35);
  }
}
