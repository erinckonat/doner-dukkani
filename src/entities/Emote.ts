import * as THREE from 'three';
import { C, canvasTexture } from '../world/Assets';

let angryTex: THREE.Texture | null = null;

/** Shared "fed up" face: red, frowning, brows down. */
function angryTexture() {
  angryTex ??= canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = C.primary;
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#FFFAF0';
    ctx.stroke();
    ctx.fillStyle = '#FFFAF0';
    ctx.strokeStyle = '#FFFAF0';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(34, 42); ctx.lineTo(54, 52);
    ctx.moveTo(94, 42); ctx.lineTo(74, 52);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(46, 64, 7, 0, Math.PI * 2);
    ctx.arc(82, 64, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 100, 20, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }).tex;
  return angryTex;
}

/** Small angry face above someone's head, hidden until they've waited too long. */
export function makeAngryEmote(y: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: angryTexture(), depthWrite: false }));
  s.scale.set(0.6, 0.6, 1);
  s.position.y = y;
  s.renderOrder = 11;
  s.visible = false;
  return s;
}
