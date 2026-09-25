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
    this.lastOut.copy(p.pos);
    p.ch.root.visible = false;
    this.g.sfx.play('moto', 1, 0);
    this.render();
  }

  /** Park here (or at the last spot on the street) and step out. */
  getOut(parkAt?: THREE.Vector3) {
    if (!this.driving) return;
    this.driving = false;
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

  update(dt: number, move: { x: number; z: number }) {
    if (!this.driving || !this.car) return;
    const p = this.g.player;
    if (this.g.insideBuilding) {
      // Drove up to a door: the car waits on the street, you walk in.
      this.getOut(this.lastOut);
      return;
    }
    this.lastOut.copy(p.pos);
    p.ch.root.visible = false;
    const r = this.car.root;
    r.position.set(p.pos.x, 0, p.pos.z);
    const mag = Math.hypot(move.x, move.z);
    if (mag > 0.05) {
      const want = Math.atan2(move.x, move.z);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-dt * 10));
    }
    r.rotation.y = this.heading;
    for (const w of this.car.wheels) w.rotation.x += dt * mag * this.speed * 2.6;
  }
}
