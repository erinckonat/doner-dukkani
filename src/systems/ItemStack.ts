import * as THREE from 'three';
import type { ProductKind } from '../config/balance';
import type { GroceryKind } from '../config/market';
import type { Flyer } from '../core/Flyer';

export type ItemKind = ProductKind | GroceryKind | 'trash';

export const ITEM_H: Record<ItemKind, number> = {
  doner: 0.17, burger: 0.17, fries: 0.2, shake: 0.27, trash: 0.13,
  // Groceries are drawn at 1.4× (GROCERY_SCALE).
  bread: 0.18, milk: 0.34, eggs: 0.14, pasta: 0.11, oil: 0.45, detergent: 0.34,
};

export type Layout = (i: number, kind: ItemKind) => THREE.Vector3;

export const columnLayout: Layout = (i, k) => new THREE.Vector3(0, i * ITEM_H[k], 0);

export function gridLayout(cols: number, rows: number, dx: number, dz: number): Layout {
  const per = cols * rows;
  return (i, k) => {
    const layer = Math.floor(i / per);
    const r = i % per;
    const c = r % cols;
    const row = Math.floor(r / cols);
    return new THREE.Vector3((c - (cols - 1) / 2) * dx, layer * ITEM_H[k], (row - (rows - 1) / 2) * dz);
  };
}

/**
 * An ordered pile of items on an anchor (hands, tray, counter, table...). Piles hold
 * one kind at a time unless `mixed` (a customer's order, a plate), where items of
 * different kinds sit on top of each other at their own heights.
 */
export class ItemStack {
  items: THREE.Object3D[] = [];
  /** Kind of the top item (the only kind, unless mixed). */
  kind: ItemKind | null = null;
  private kinds: ItemKind[] = [];

  constructor(
    public anchor: THREE.Object3D,
    private flyer: Flyer,
    public capacity: () => number,
    public layout: Layout = columnLayout,
    public mixed = false,
  ) {}

  get count() { return this.items.length; }
  get isFull() { return this.items.length >= this.capacity(); }

  canAccept(kind: ItemKind) {
    return !this.isFull && (this.mixed || this.kind === null || this.kind === kind);
  }

  receive(obj: THREE.Object3D, kind: ItemKind, dur = 0.28, onDone?: () => void) {
    const i = this.items.length;
    // Mixed piles stack by item height unless given their own layout (a basket, a belt).
    const local = this.mixed && this.layout === columnLayout
      ? new THREE.Vector3(0, this.kinds.reduce((h, k) => h + ITEM_H[k], 0), 0)
      : this.layout(i, kind);
    this.items.push(obj);
    this.kinds.push(kind);
    this.kind = kind;
    this.flyer.fly(obj, this.anchor, local, { dur, onDone });
  }

  /** Place an item straight onto the pile with no flight (loading a save, restocking a new shelf). */
  put(obj: THREE.Object3D, kind: ItemKind) {
    const i = this.items.length;
    this.anchor.add(obj);
    obj.position.copy(this.layout(i, kind));
    this.items.push(obj);
    this.kinds.push(kind);
    this.kind = kind;
  }

  take(): THREE.Object3D | undefined {
    const o = this.items.pop();
    this.kinds.pop();
    this.kind = this.kinds[this.kinds.length - 1] ?? null;
    return o;
  }

  /** Remove everything from the world. */
  clear() {
    for (const o of this.items) {
      this.flyer.cancel(o);
      o.removeFromParent();
    }
    const n = this.items.length;
    this.items = [];
    this.kinds = [];
    this.kind = null;
    return n;
  }
}

export function transfer(from: ItemStack, to: ItemStack, dur?: number) {
  if (!from.count) return false;
  const kind = from.kind!;
  if (!to.canAccept(kind)) return false;
  to.receive(from.take()!, kind, dur);
  return true;
}
