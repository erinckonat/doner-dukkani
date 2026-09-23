import * as THREE from 'three';
import type { ProductKind } from '../config/balance';
import { C, canvasTexture, drawProductIcon, roundRect } from '../world/Assets';

const W = 256;
const H = 128;
const ITEM_W = 76;

/** Speech bubble listing what is still owed per product; turns red when kept waiting. */
export class OrderBubble {
  sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';

  constructor(private border = 'rgba(42,30,24,0.25)') {
    const { tex, ctx } = canvasTexture(W, H, () => {});
    this.ctx = ctx;
    this.tex = tex;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    this.sprite.scale.set(1.7, 0.85, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  show(items: [ProductKind, number][], angry: boolean) {
    this.sprite.visible = true;
    const key = `${items.map(([k, n]) => k + n).join()}|${angry}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const w = Math.max(112, 24 + items.length * ITEM_W);
    const x0 = (W - w) / 2;
    ctx.fillStyle = angry ? '#FBE3DC' : '#FFFAF0';
    roundRect(ctx, x0, 8, w, 84, 26);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 12, 90); ctx.lineTo(W / 2, 112); ctx.lineTo(W / 2 + 12, 90);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = angry ? C.primary : this.border;
    roundRect(ctx, x0, 8, w, 84, 26);
    ctx.stroke();
    ctx.font = '800 44px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = angry ? C.primary : C.dark;
    items.forEach(([kind, n], i) => {
      const cx = x0 + 12 + ITEM_W * i + ITEM_W / 2;
      drawProductIcon(ctx, kind, cx - 14, 50, 18);
      ctx.fillText(String(n), cx + 22, 54);
    });
    this.tex.needsUpdate = true;
  }

  hide() { this.sprite.visible = false; }

  dispose() {
    this.sprite.removeFromParent();
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
