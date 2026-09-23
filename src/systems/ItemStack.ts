import * as THREE from 'three';
import type { Flyer } from '../core/Flyer';

export type ItemKind = 'doner' | 'trash';

export const ITEM_H: Record<ItemKind, number> = { doner: 0.17, trash: 0.13 };

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

/** An ordered pile of one kind of item on an anchor (hands, tray, counter, table...). */
export class ItemStack {
  items: THREE.Object3D[] = [];
  kind: ItemKind | null = null;

  constructor(
    public anchor: THREE.Object3D,
    private flyer: Flyer,
    public capacity: () => number,
    public layout: Layout = columnLayout,
  ) {}

  get count() { return this.items.length; }
  get isFull() { return this.items.length >= this.capacity(); }

  canAccept(kind: ItemKind) {
    return !this.isFull && (this.kind === null || this.kind === kind);
  }

  receive(obj: THREE.Object3D, kind: ItemKind, dur = 0.28, onDone?: () => void) {
    const i = this.items.length;
    this.items.push(obj);
    this.kind = kind;
    this.flyer.fly(obj, this.anchor, this.layout(i, kind), { dur, onDone });
  }

  take(): THREE.Object3D | undefined {
    const o = this.items.pop();
    if (!this.items.length) this.kind = null;
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
