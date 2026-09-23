import * as THREE from 'three';
import type { Tweens } from '../core/Tween';
import { C, canvasTexture, mat } from '../world/Assets';

const COLORS = [C.primary, C.gold, C.cream, '#5E9C55'];
const piece = new THREE.BoxGeometry(0.1, 0.02, 0.14);

interface Bit { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number }

export class Confetti {
  private bits: Bit[] = [];
  constructor(private scene: THREE.Scene) {}

  burst(at: THREE.Vector3, n = 28) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(piece, mat(COLORS[i % COLORS.length]));
      m.position.set(at.x, 0.4, at.z);
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2;
      this.scene.add(m);
      this.bits.push({
        m,
        v: new THREE.Vector3(Math.cos(a) * s, 4 + Math.random() * 3, Math.sin(a) * s),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        life: 1.2 + Math.random() * 0.4,
      });
    }
  }

  update(dt: number) {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= dt;
      b.v.y -= 12 * dt;
      b.v.multiplyScalar(1 - dt * 1.5);
      b.m.position.addScaledVector(b.v, dt);
      if (b.m.position.y < 0.02) { b.m.position.y = 0.02; b.v.set(0, 0, 0); }
      else { b.m.rotation.x += b.spin.x * dt; b.m.rotation.y += b.spin.y * dt; b.m.rotation.z += b.spin.z * dt; }
      if (b.life <= 0) { b.m.removeFromParent(); this.bits.splice(i, 1); }
    }
  }
}

/** Text that rises and fades: "+₺400" where money was earned, or a red note. */
export class FloatingText {
  constructor(private scene: THREE.Scene, private tweens: Tweens, private reduced: boolean) {}

  spawn(at: THREE.Vector3, text: string, style: 'money' | 'angry' = 'money') {
    const angry = style === 'angry';
    const { tex } = canvasTexture(angry ? 512 : 256, 96, (ctx) => {
      ctx.font = `800 ${angry ? 44 : 64}px "Baloo 2", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 12;
      ctx.strokeStyle = C.dark;
      const cx = angry ? 256 : 128;
      ctx.strokeText(text, cx, 52);
      ctx.fillStyle = angry ? '#F07A62' : C.gold;
      ctx.fillText(text, cx, 52);
    });
    const material = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true });
    const s = new THREE.Sprite(material);
    s.scale.set(angry ? 3.2 : 1.6, 0.6, 1);
    s.renderOrder = 20;
    s.position.set(at.x, at.y + 0.6, at.z);
    this.scene.add(s);
    const y0 = s.position.y;
    const rise = this.reduced ? 0 : 1.2;
    this.tweens.add(1.1, (k) => {
      s.position.y = y0 + rise * (1 - (1 - k) ** 2);
      material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }, () => {
      s.removeFromParent();
      material.dispose();
      tex.dispose();
    });
  }
}

/** Bouncing arrow plus a pulsing floor ring marking the tutorial target. */
export function makeArrow() {
  const group = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.75, 4), mat(C.primary, C.primary, 0.25));
  cone.rotation.x = Math.PI;
  cone.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.8, 32),
    new THREE.MeshBasicMaterial({ color: C.primary, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.045;
  ring.renderOrder = 2;
  group.add(cone, ring);
  return { group, cone, ring };
}
