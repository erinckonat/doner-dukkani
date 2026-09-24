import * as THREE from 'three';

const DROPS = 900;
/** Box of rain around the camera's focus: half-width, height, half-depth. */
const HX = 30;
const HY = 18;
const HZ = 22;
const FALL = 22;
const STREAK = 0.55;

/**
 * Rain streaks that follow the camera, and a 0..1 `k` that eases in and out so the
 * sky, the light and the sound can dim along with it.
 */
export class Rain {
  k = 0;
  private lines: THREE.LineSegments;
  private pos: Float32Array;
  private mat: THREE.LineBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(DROPS * 6);
    for (let i = 0; i < DROPS; i++) this.place(i, Math.random() * HY);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: '#C9D4DC', transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  private place(i: number, y: number) {
    const x = (Math.random() * 2 - 1) * HX;
    const z = (Math.random() * 2 - 1) * HZ;
    const o = i * 6;
    // Slanted a little, as if a breeze came off the street.
    this.pos.set([x, y, z, x + 0.12, y + STREAK, z], o);
  }

  update(dt: number, on: boolean, center: THREE.Vector3, reduced: boolean) {
    this.k += ((on ? 1 : 0) - this.k) * (1 - Math.exp(-dt * 0.8));
    if (this.k < 0.01 && !on) this.k = 0;
    const show = this.k > 0 && !reduced;
    this.lines.visible = show;
    if (!show) return;
    this.mat.opacity = 0.55 * this.k;
    this.lines.position.set(center.x, center.y, center.z);
    const p = this.pos;
    for (let i = 0; i < DROPS; i++) {
      const o = i * 6;
      const dy = FALL * dt;
      p[o + 1] -= dy;
      p[o + 4] -= dy;
      p[o] -= dy * 0.2;
      p[o + 3] -= dy * 0.2;
      if (p[o + 1] < 0) this.place(i, HY);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
