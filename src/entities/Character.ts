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
  /** Head, face, hair and hat: turns on its own to look around. */
  private head = new THREE.Group();
  private phase = Math.random() * 6;
  private amp = 0;
  private yaw = 0;
  /** 0 walking … 1 running, eased. */
  private run = 0;
  /** Lean into the current turn, eased. */
  private turnLean = 0;
  private turnRate = 0;
  private lean = 0;
  // Idle: breathing, and now and then a look to one side.
  private idleT = Math.random() * 10;
  private lookT = 1 + Math.random() * 3;
  private look = 0;
  private lookAt = 0;

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
    // The head pivots at the neck (y 1.3) so it can nod and turn.
    const hy = 1.3;
    this.head.position.y = hy;
    this.model.add(this.head);
    this.head.add(m(G.head, look.skin, 0, 1.5 - hy, 0));
    this.head.add(m(G.eye, '#2A1E18', -0.09, 1.53 - hy, 0.225, false), m(G.eye, '#2A1E18', 0.09, 1.53 - hy, 0.225, false));
    if (look.hair) {
      const hair = m(G.hair, look.hair, 0, 1.6 - hy, -0.03);
      hair.scale.set(1, 0.62, 1);
      this.head.add(hair);
    }
    if (look.hat === 'chef') {
      this.head.add(m(G.chef, '#FBF6EC', 0, 1.79 - hy, 0), m(G.chefTop, '#FBF6EC', 0, 1.97 - hy, 0));
    } else if (look.hat === 'cap') {
      this.head.add(m(G.cap, look.hatColor ?? '#C8412B', 0, 1.7 - hy, 0), m(G.brim, look.hatColor ?? '#C8412B', 0, 1.66 - hy, 0.24));
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

  /**
   * Walk/run cycle from the speed (m/s): stride and cadence grow with it, and past a
   * brisk walk the figure leans into a run with bent, pumping arms. Hips sway, the
   * body leans into turns, and standing still it breathes and looks about.
   */
  animate(dt: number, speed: number) {
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    const moving = speed > 0.1;
    this.amp += ((moving ? 1 : 0) - this.amp) * k(8);
    this.run += (Math.min(1, Math.max(0, (speed - 3) / 2)) - this.run) * k(4);
    // Cadence: steps come quicker with speed, but stride takes most of the increase.
    if (moving) this.phase += dt * (2.6 + speed * 1.9);
    const a = this.amp;
    const r = this.run;
    const s = Math.sin(this.phase) * a;
    const c = Math.cos(this.phase);
    this.idleT += dt;
    this.turnLean += (Math.max(-0.14, Math.min(0.14, -this.turnRate * 0.05)) * a - this.turnLean) * k(6);
    this.turnRate *= Math.exp(-dt * 6);
    if (this.sitting) {
      this.legL.rotation.x = this.legR.rotation.x = -Math.PI / 2;
      this.model.position.y = -0.06;
      this.model.rotation.set(0, 0, 0);
      this.model.scale.y = 1 + Math.sin(this.idleT * 2) * 0.008;
      this.armL.rotation.x = this.armR.rotation.x = -0.6;
      this.armL.rotation.z = this.armR.rotation.z = 0;
      this.head.rotation.set(0, 0, 0);
      return;
    }
    // Legs: a longer swing when running, and the back leg kicks a little higher.
    const stride = 0.5 + 0.3 * r;
    this.legL.rotation.x = s * stride + Math.max(0, -s) * 0.15 * r;
    this.legR.rotation.x = -s * stride + Math.max(0, s) * 0.15 * r;
    // Two bobs a stride; running bounces higher. Standing, the chest rises and falls.
    this.model.position.y = Math.abs(c) * (0.03 + 0.05 * r) * a;
    this.model.scale.y = 1 + Math.sin(this.idleT * 2.2) * 0.012 * (1 - a);
    // Lean forward with pace, sway at the hips, twist the shoulders against the stride.
    this.lean += ((0.03 + 0.16 * r) * a - this.lean) * k(5);
    this.model.rotation.x = this.lean;
    this.model.rotation.z = s * 0.035 * (1 - 0.5 * r) + this.turnLean;
    this.model.rotation.y = s * 0.07 * (1 - 0.4 * r);
    // Arms swing against the legs; running, they bend forward and pump harder.
    if (this.carrying) {
      const hold = -1.2 + s * 0.04;
      this.armL.rotation.x = this.armR.rotation.x = hold;
      this.armL.rotation.z = this.armR.rotation.z = 0;
    } else {
      const swing = 0.5 + 0.35 * r;
      const bend = -0.55 * r * a;
      this.armL.rotation.x = -s * swing + bend;
      this.armR.rotation.x = s * swing + bend;
      this.armL.rotation.z = -0.05 - 0.08 * r * a;
      this.armR.rotation.z = 0.05 + 0.08 * r * a;
    }
    // Head: steady on the move (counters the bob and the lean); idle, it looks around now and then.
    if (a > 0.3) {
      this.lookAt = 0;
      this.lookT = 1.5 + Math.random() * 3;
    } else {
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookT = 2 + Math.random() * 4;
        this.lookAt = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.2;
      }
    }
    this.look += (this.lookAt - this.look) * k(3);
    this.head.rotation.y = this.look - this.model.rotation.y;
    this.head.rotation.x = -this.lean * 0.6 - c * 0.025 * a + Math.sin(this.idleT * 0.7) * 0.02 * (1 - a);
    // Stack leans back a touch while walking.
    this.hand.rotation.x += (-a * 0.1 - this.hand.rotation.x) * Math.min(1, dt * 8);
  }

  face(dx: number, dz: number, dt: number) {
    if (dx * dx + dz * dz < 1e-6) return;
    const t = Math.atan2(dx, dz);
    let d = t - this.yaw;
    d = ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const step = d * Math.min(1, dt * 12);
    this.yaw += step;
    this.root.rotation.y = this.yaw;
    // How fast we're turning (rad/s), for leaning into the turn.
    if (dt > 0) this.turnRate = step / dt;
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
