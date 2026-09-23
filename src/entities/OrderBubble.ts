import * as THREE from 'three';
import { C, canvasTexture, drawDonerIcon, roundRect } from '../world/Assets';

/** Speech bubble showing how many döner are still owed; turns red when kept waiting. */
export class OrderBubble {
  sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';

  constructor(private border = 'rgba(42,30,24,0.25)', scale = 0.85) {
    const { tex, ctx } = canvasTexture(128, 128, () => {});
    this.ctx = ctx;
    this.tex = tex;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    this.sprite.scale.set(scale, scale, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  show(count: number, angry: boolean) {
    this.sprite.visible = true;
    const key = `${count}|${angry}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = angry ? '#FBE3DC' : '#FFFAF0';
    roundRect(ctx, 8, 8, 112, 84, 26);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(52, 90); ctx.lineTo(64, 112); ctx.lineTo(76, 90);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = angry ? C.primary : this.border;
    roundRect(ctx, 8, 8, 112, 84, 26);
    ctx.stroke();
    drawDonerIcon(ctx, 42, 50, 22);
    ctx.fillStyle = angry ? C.primary : C.dark;
    ctx.font = '800 48px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), 88, 54);
    this.tex.needsUpdate = true;
  }

  hide() { this.sprite.visible = false; }

  dispose() {
    this.sprite.removeFromParent();
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
