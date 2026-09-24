import * as THREE from 'three';
import { mat } from '../world/Assets';

const G = {
  body: new THREE.CapsuleGeometry(0.26, 0.3, 3, 8),
  head: new THREE.IcosahedronGeometry(0.25, 1),
  hair: new THREE.IcosahedronGeometry(0.265, 1),
  eye: new THREE.SphereGeometry(0.035, 6, 4),
  leg: new THREE.CapsuleGeometry(0.09, 0.26, 2, 6),
  arm: new THREE.CapsuleGeometry(0.07, 0.28, 2, 6),
  chef: new THREE.CylinderGeometry(0.19, 0.17, 0.26, 8),
  chefTop: new THREE.IcosahedronGeometry(0.21, 0),
  cap: new THREE.CylinderGeometry(0.25, 0.265, 0.12, 8),
  brim: new THREE.BoxGeometry(0.3, 0.03, 0.2),
  apron: new THREE.BoxGeometry(0.36, 0.4, 0.04),
  collar: new THREE.BoxGeometry(0.3, 0.1, 0.12),
  tie: new THREE.BoxGeometry(0.08, 0.34, 0.03),
  lapel: new THREE.BoxGeometry(0.1, 0.36, 0.03),
};

export interface Look {
  shirt: string;
  pants: string;
  skin: string;
  hair?: string;
  hat?: 'chef' | 'cap';
  hatColor?: string;
  apron?: string;
  /** Collar colour (shirt under a jacket) and tie colour, for suits. */
  collar?: string;
  tie?: string;
}

/** Low-poly figure built from primitives. Faces +z locally. */
export class Character {
  root = new THREE.Group();
  model = new THREE.Group();
  /** Where carried items stack. */
  hand = new THREE.Group();
  sitting = false;
  carrying = false;
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private phase = Math.random() * 6;
  private amp = 0;
  private yaw = 0;

  constructor(look: Look) {
    const m = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number, shadow = true) => {
      const mesh = new THREE.Mesh(g, mat(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      return mesh;
    };
    this.root.add(this.model);
    this.model.add(m(G.body, look.shirt, 0, 0.9, 0));
    if (look.apron) this.model.add(m(G.apron, look.apron, 0, 0.78, 0.24));
    if (look.collar) {
      // Open jacket: shirt showing down the middle, collar at the neck.
      this.model.add(m(G.collar, look.collar, 0, 1.22, 0.14, false));
      this.model.add(m(G.lapel, look.collar, 0, 1.02, 0.25, false));
    }
    if (look.tie) this.model.add(m(G.tie, look.tie, 0, 1.0, 0.27, false));
    this.model.add(m(G.head, look.skin, 0, 1.5, 0));
    this.model.add(m(G.eye, '#2A1E18', -0.09, 1.53, 0.225, false), m(G.eye, '#2A1E18', 0.09, 1.53, 0.225, false));
    if (look.hair) {
      const hair = m(G.hair, look.hair, 0, 1.6, -0.03);
      hair.scale.set(1, 0.62, 1);
      this.model.add(hair);
    }
    if (look.hat === 'chef') {
      this.model.add(m(G.chef, '#FBF6EC', 0, 1.79, 0), m(G.chefTop, '#FBF6EC', 0, 1.97, 0));
    } else if (look.hat === 'cap') {
      this.model.add(m(G.cap, look.hatColor ?? '#C8412B', 0, 1.7, 0), m(G.brim, look.hatColor ?? '#C8412B', 0, 1.66, 0.24));
    }
    for (const [leg, x] of [[this.legL, -0.12], [this.legR, 0.12]] as const) {
      leg.position.set(x, 0.52, 0);
      leg.add(m(G.leg, look.pants, 0, -0.24, 0));
      this.model.add(leg);
    }
    for (const [arm, x] of [[this.armL, -0.34], [this.armR, 0.34]] as const) {
      arm.position.set(x, 1.12, 0);
      arm.add(m(G.arm, look.shirt, 0, -0.2, 0));
      this.model.add(arm);
    }
    this.hand.position.set(0, 0.86, 0.4);
    this.model.add(this.hand);
  }

  animate(dt: number, speed: number) {
    const target = speed > 0.1 ? 1 : 0;
    this.amp += (target - this.amp) * Math.min(1, dt * 10);
    this.phase += dt * (3 + speed * 2.4);
    const s = Math.sin(this.phase) * this.amp;
    if (this.sitting) {
      this.legL.rotation.x = this.legR.rotation.x = -Math.PI / 2;
      this.model.position.y = -0.06;
      this.armL.rotation.x = this.armR.rotation.x = -0.6;
      return;
    }
    this.legL.rotation.x = s * 0.7;
    this.legR.rotation.x = -s * 0.7;
    this.model.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * this.amp;
    const armCarry = -1.2 + s * 0.04;
    this.armL.rotation.x = this.carrying ? armCarry : -s * 0.6;
    this.armR.rotation.x = this.carrying ? armCarry : s * 0.6;
    // Stack leans back a touch while walking.
    this.hand.rotation.x += (-this.amp * 0.1 - this.hand.rotation.x) * Math.min(1, dt * 8);
  }

  face(dx: number, dz: number, dt: number) {
    if (dx * dx + dz * dz < 1e-6) return;
    const t = Math.atan2(dx, dz);
    let d = t - this.yaw;
    d = ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    this.yaw += d * Math.min(1, dt * 12);
    this.root.rotation.y = this.yaw;
  }

  setYaw(a: number) {
    this.yaw = a;
    this.root.rotation.y = a;
  }
}

export const LOOKS = {
  shirts: ['#5B7FA3', '#7FA36B', '#D08C3E', '#9C7BB0', '#C45B6E', '#4E8C8A', '#B5A04A', '#6C6F8C', '#D9A6A0'],
  pants: ['#3D3A4A', '#5A4A3A', '#2F4858', '#6B5B4B', '#46503A'],
  skins: ['#F2C9A0', '#E0AC80', '#C68A5E', '#8D5B3C', '#F5D5B8'],
  hair: ['#2A1E18', '#5A3A22', '#8A5A2B', '#C9A06A', '#3B3B3B'],
};

export const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
