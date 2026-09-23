import * as THREE from 'three';

export interface Rect { x0: number; x1: number; z0: number; z1: number }

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Grid A* over the whole map with line-of-sight path smoothing. */
export class Nav {
  readonly cell = 0.5;
  readonly w: number;
  readonly h: number;
  private blocked: Uint8Array;
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private state: Uint8Array; // 0 unseen, 1 open, 2 closed

  constructor(private minX: number, private minZ: number, maxX: number, maxZ: number) {
    this.w = Math.ceil((maxX - minX) / this.cell);
    this.h = Math.ceil((maxZ - minZ) / this.cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.state = new Uint8Array(n);
  }

  rebuild(rects: Rect[], pad = 0.3) {
    this.blocked.fill(0);
    for (const r of rects) {
      for (let cz = 0; cz < this.h; cz++) {
        const z = this.minZ + (cz + 0.5) * this.cell;
        if (z < r.z0 - pad || z > r.z1 + pad) continue;
        for (let cx = 0; cx < this.w; cx++) {
          const x = this.minX + (cx + 0.5) * this.cell;
          if (x >= r.x0 - pad && x <= r.x1 + pad) this.blocked[cz * this.w + cx] = 1;
        }
      }
    }
  }

  private cx(x: number) { return Math.max(0, Math.min(this.w - 1, Math.floor((x - this.minX) / this.cell))); }
  private cz(z: number) { return Math.max(0, Math.min(this.h - 1, Math.floor((z - this.minZ) / this.cell))); }

  private free(x: number, z: number) {
    return !this.blocked[this.cz(z) * this.w + this.cx(x)];
  }

  private lineFree(a: THREE.Vector3, b: THREE.Vector3, skipA: number, skipB: number) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / 0.2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const idx = this.cz(z) * this.w + this.cx(x);
      if (idx === skipA || idx === skipB) continue;
      if (this.blocked[idx]) return false;
    }
    return true;
  }

  find(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const w = this.w;
    const start = this.cz(from.z) * w + this.cx(from.x);
    const goal = this.cz(to.z) * w + this.cx(to.x);
    const dest = new THREE.Vector3(to.x, 0, to.z);
    if (start === goal || this.lineFree(from, to, start, goal)) return [dest];

    this.state.fill(0);
    const gx = goal % w;
    const gz = (goal / w) | 0;
    const heur = (i: number) => {
      const dx = Math.abs((i % w) - gx);
      const dz = Math.abs(((i / w) | 0) - gz);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
    };
    const heap: number[] = [start];
    this.g[start] = 0;
    this.f[start] = heur(start);
    this.parent[start] = -1;
    this.state[start] = 1;
    const walk = (i: number) => i === goal || i === start || !this.blocked[i];

    let found = false;
    while (heap.length) {
      const cur = this.pop(heap);
      if (this.state[cur] === 2) continue;
      this.state[cur] = 2;
      if (cur === goal) { found = true; break; }
      const x = cur % w;
      const z = (cur / w) | 0;
      for (const [dx, dz, cost] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= this.h) continue;
        const ni = nz * w + nx;
        if (!walk(ni) || this.state[ni] === 2) continue;
        if (dx && dz && (!walk(z * w + nx) || !walk(nz * w + x))) continue;
        const ng = this.g[cur] + cost;
        if (this.state[ni] === 1 && ng >= this.g[ni]) continue;
        this.g[ni] = ng;
        this.f[ni] = ng + heur(ni);
        this.parent[ni] = cur;
        this.state[ni] = 1;
        this.push(heap, ni);
      }
    }
    if (!found) return [dest];

    const cells: THREE.Vector3[] = [];
    for (let i = this.parent[goal]; i !== -1 && i !== start; i = this.parent[i]) {
      cells.push(new THREE.Vector3(this.minX + ((i % w) + 0.5) * this.cell, 0, this.minZ + (((i / w) | 0) + 0.5) * this.cell));
    }
    cells.reverse();
    cells.push(dest);

    // String-pull: skip waypoints while there is a clear line.
    const out: THREE.Vector3[] = [];
    let anchor = from;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineFree(anchor, cells[j], start, goal)) j--;
      out.push(cells[j]);
      anchor = cells[j];
      i = j + 1;
    }
    return out;
  }

  isFree(x: number, z: number) { return this.free(x, z); }

  private push(heap: number[], i: number) {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.f[heap[p]] <= this.f[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  }

  private pop(heap: number[]) {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
        if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  }
}
