import * as THREE from 'three';
import { C, canvasTexture, floorDecal, roundRect } from '../world/Assets';

export interface TileDef {
  id: string;
  cost: number;
  x: number;
  z: number;
  label: string;
  /** Shown instead of a price on free tiles (e.g. travel between shops). */
  note?: string;
}

const SIZE = 256;

/** Floor tile that swallows money while the player stands on it. */
export class UnlockTile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  hold = 0;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private shown = -1;

  constructor(public def: TileDef, public paid: number, scene: THREE.Object3D) {
    const { tex, ctx } = canvasTexture(SIZE, SIZE, () => {});
    this.ctx = ctx;
    this.tex = tex;
    this.mesh = floorDecal(tex, 1.9);
    this.mesh.position.set(def.x, 0.035, def.z);
    this.pos = new THREE.Vector3(def.x, 0, def.z);
    scene.add(this.mesh);
    this.draw();
  }

  get remaining() { return Math.max(0, this.def.cost - this.paid); }

  draw() {
    const remain = Math.ceil(this.remaining);
    if (remain === this.shown) return;
    this.shown = remain;
    const ctx = this.ctx;
    const p = this.def.cost ? this.paid / this.def.cost : 0;
    ctx.clearRect(0, 0, SIZE, SIZE);
    roundRect(ctx, 12, 12, 232, 232, 40);
    ctx.fillStyle = 'rgba(255,250,240,0.9)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(227,166,74,0.85)';
    ctx.fillRect(0, SIZE - SIZE * p, SIZE, SIZE * p);
    ctx.restore();
    roundRect(ctx, 12, 12, 232, 232, 40);
    ctx.setLineDash([22, 14]);
    ctx.lineWidth = 8;
    ctx.strokeStyle = C.gold;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.dark;
    ctx.font = `700 ${this.def.label.length > 11 ? 26 : 32}px "Baloo 2", sans-serif`;
    ctx.fillText(this.def.label, 128, 76);
    if (this.def.cost === 0) {
      ctx.fillStyle = C.primary;
      ctx.font = '800 44px "Baloo 2", sans-serif';
      ctx.fillText(this.def.note ?? '', 128, 150);
    } else {
      // Coin + amount, shrunk until the pair fits the tile, then centred.
      const text = remain.toLocaleString('tr-TR');
      let size = 54;
      let w = 0;
      do {
        ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
        w = ctx.measureText(text).width;
      } while (48 + 8 + w > 208 && (size -= 2) > 24);
      const x0 = 128 - (48 + 8 + w) / 2;
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(x0 + 24, 152, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.dark;
      ctx.font = '800 30px "Baloo 2", sans-serif';
      ctx.fillText('₺', x0 + 24, 154);
      ctx.textAlign = 'left';
      ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
      ctx.fillText(text, x0 + 56, 156);
    }
    this.tex.needsUpdate = true;
  }

  update(time: number) {
    this.mesh.scale.setScalar(1 + Math.sin(time * 4) * 0.025);
  }

  dispose() {
    this.mesh.removeFromParent();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
    this.mesh.geometry.dispose();
  }
}
