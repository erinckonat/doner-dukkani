import * as THREE from 'three';
import { carModel, type CarModel } from '../config/cars';
import type { Game } from '../Game';
import { TR } from '../ui/strings.tr';
import { GALLERY, GALLERY_ORIGIN } from '../config/gallery';
import { makeCarModel } from '../world/Vehicles';

/** A new car waits on the pavement outside the gallery, nose along the street. */
const GALLERY_KERB = new THREE.Vector3(GALLERY_ORIGIN.x + 6, 0, GALLERY_ORIGIN.z + GALLERY.halfD + 4.2);

/**
 * The player's own car. The key button gets you in (the car pulls up where you
 * stand) and out (it stays parked there). Driving goes at the car's speed; walk
 * into a building, a shop or a business's door and you park and carry on on foot.
 */
export class Driving {
  driving = false;
  private car: ReturnType<typeof makeCarModel> | null = null;
  private model: CarModel | null = null;
  private btn = document.getElementById('car-btn') as HTMLButtonElement;
  /** Last spot on the street while driving: where the car parks if you drive into a building. */
  private lastOut = new THREE.Vector3();
  private heading = 0;
  /** The car's velocity on the ground (x, z), eased towards what the stick asks for. */
  private vel = new THREE.Vector2();
  private prev = new THREE.Vector3();
  private lastSpeed = 0;
  private yawRate = 0;
  private roll = 0;
  private pitch = 0;
  private wheelTurn = 0;
  private t = 0;

  constructor(private g: Game) {
    this.btn.addEventListener('click', () => this.toggle());
    addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f' && !e.repeat && this.model) this.toggle(); });
    this.setModel(g.data.garage?.active ?? null);
  }

  get speed() { return this.model?.speed ?? 0; }
  get active() { return this.model; }

  /**
   * Swap to another owned car (or none). It stands where the last one was parked, or
   * at `at` (a new car waits outside the gallery); it's always there to see.
   */
  setModel(id: string | null, at?: THREE.Vector3) {
    const gar = this.g.data.garage;
    const park = gar?.park;
    const pos = at ?? this.car?.root.position.clone() ?? (park ? new THREE.Vector3(park[0], 0, park[1]) : GALLERY_KERB.clone());
    const rot = at ? Math.PI / 2 : this.car?.root.rotation.y ?? park?.[2] ?? Math.PI / 2;
    this.car?.root.removeFromParent();
    this.car = null;
    this.model = id ? carModel(id) : null;
    this.btn.hidden = !this.model;
    if (!this.model) {
      if (this.driving) this.getOut();
      return;
    }
    this.car = makeCarModel(this.model.style, this.model.paint);
    this.car.root.position.set(pos.x, 0, pos.z);
    this.car.root.rotation.y = rot;
    this.g.scene.add(this.car.root);
    this.remember();
    this.render();
  }

  /** Keep the parking spot in the save, so the car is where you left it next time. */
  private remember() {
    const gar = this.g.data.garage;
    if (!gar || !this.car) return;
    const r = this.car.root;
    gar.park = [Math.round(r.position.x * 10) / 10, Math.round(r.position.z * 10) / 10, Math.round(r.rotation.y * 100) / 100];
  }

  toggle() {
    if (this.driving) this.getOut();
    else this.getIn();
  }

  private getIn() {
    if (!this.car) return;
    const p = this.g.player;
    if (p.pos.y > 0.01 || this.g.insideBuilding) {
      this.g.hud.toast(TR.car.goOutside);
      return;
    }
    this.driving = true;
    this.car.root.visible = true;
    this.car.root.position.set(p.pos.x, 0, p.pos.z);
    this.heading = this.car.root.rotation.y;
    this.vel.set(0, 0);
    this.lastSpeed = 0;
    this.prev.copy(p.pos);
    this.lastOut.copy(p.pos);
    p.ch.root.visible = false;
    this.g.sfx.play('moto', 1, 0);
    this.render();
  }

  /** Park here (or at the last spot on the street) and step out. */
  getOut(parkAt?: THREE.Vector3) {
    if (!this.driving) return;
    this.driving = false;
    this.vel.set(0, 0);
    this.settle();
    this.g.player.ch.root.visible = true;
    if (this.car && parkAt) this.car.root.position.set(parkAt.x, 0, parkAt.z);
    this.remember();
    this.render();
  }

  private render() {
    this.btn.classList.toggle('on', this.driving);
    this.btn.setAttribute('aria-pressed', String(this.driving));
    this.btn.setAttribute('aria-label', this.driving ? TR.car.out : TR.car.in);
  }

  /**
   * Turn the stick into the car's motion: it gathers speed (and sheds it) at a car's
   * pace rather than at once, and brakes harder than it accelerates.
   */
  steer(dt: number, move: { x: number; z: number }) {
    const target = new THREE.Vector2(move.x, move.z).multiplyScalar(this.speed);
    const diff = target.clone().sub(this.vel);
    // Pulling away 9 m/s²; letting go rolls to a stop (6); pulling back brakes hard (18).
    const rate = target.dot(this.vel) < 0 ? 18 : target.lengthSq() < 0.01 ? 6 : target.length() < this.vel.length() ? 12 : 9;
    const step = Math.min(diff.length(), rate * dt);
    if (diff.lengthSq() > 1e-8) this.vel.add(diff.normalize().multiplyScalar(step));
    const sp = this.vel.length();
    return sp > 0.05 ? { move: { x: this.vel.x / sp, z: this.vel.y / sp }, speed: sp } : { move: { x: 0, z: 0 }, speed: 0 };
  }

  /** Back on its springs, wheels straight: how a parked car sits. */
  private settle() {
    if (!this.car) return;
    this.roll = this.pitch = this.wheelTurn = 0;
    this.car.body.rotation.set(0, 0, 0);
    this.car.body.position.y = 0;
    for (const s of this.car.steer) s.rotation.y = 0;
  }

  update(dt: number, _move: { x: number; z: number }) {
    if (!this.driving || !this.car || dt <= 0) return;
    const p = this.g.player;
    if (this.g.insideBuilding) {
      // Drove up to a door: the car waits on the street, you walk in.
      this.getOut(this.lastOut);
      return;
    }
    this.lastOut.copy(p.pos);
    p.ch.root.visible = false;
    // Where it actually got to: a wall stops the car dead.
    const real = new THREE.Vector2(p.pos.x - this.prev.x, p.pos.z - this.prev.z).divideScalar(dt);
    this.prev.copy(p.pos);
    if (real.length() < this.vel.length() * 0.6) this.vel.setLength(real.length());
    const sp = this.vel.length();
    const accel = (sp - this.lastSpeed) / dt;
    this.lastSpeed = sp;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    const r = this.car.root;
    r.position.set(p.pos.x, 0, p.pos.z);
    // Point the way it's going (once it's rolling).
    const before = this.heading;
    if (sp > 0.4) {
      const want = Math.atan2(this.vel.x, this.vel.y);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * k(Math.min(10, 2 + sp));
    }
    r.rotation.y = this.heading;
    this.yawRate += ((this.heading - before) / dt - this.yawRate) * k(10);
    // Front wheels steer into the turn; the body rolls out of it, dips its nose under
    // braking and squats under power, and rides a little on its springs.
    this.wheelTurn += (Math.max(-0.5, Math.min(0.5, this.yawRate * 0.35)) - this.wheelTurn) * k(12);
    for (const s of this.car.steer) s.rotation.y = this.wheelTurn;
    this.roll += (Math.max(-0.09, Math.min(0.09, this.yawRate * sp * 0.012)) - this.roll) * k(6);
    this.pitch += (Math.max(-0.06, Math.min(0.06, -accel * 0.006)) - this.pitch) * k(6);
    this.t += dt;
    this.car.body.rotation.set(this.pitch, 0, this.roll);
    this.car.body.position.y = Math.sin(this.t * 13) * 0.012 * Math.min(1, sp / 10);
    for (const w of this.car.wheels) w.rotation.x += (sp * dt) / this.car.radius;
  }
}
