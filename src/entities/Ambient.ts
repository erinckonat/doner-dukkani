import * as THREE from 'three';
import type { CarStyle } from '../config/cars';
import { at, box, C } from '../world/Assets';
import { CITY } from '../world/layout';
import { makeBus, makeCarModel } from '../world/Vehicles';
import { Character, LOOKS, pick } from './Character';

const PAINT = ['#B8473A', '#3F6E8C', '#E0B04A', '#5E8C5A', '#D9D2C5', '#4A4550', '#8C5A7A', '#2F3A44', '#E9E4DA'];
const STYLES: CarStyle[] = ['hatch', 'sedan', 'sedan', 'suv', 'classic', 'hatch', 'sport'];

interface Walker {
  ch: Character;
  dir: 1 | -1;
  speed: number;
  /** Stopped to look in a window: seconds left, and the side of the street it faces. */
  pause: number;
  nextPause: number;
  north: boolean;
}

interface Vehicle {
  v: ReturnType<typeof makeCarModel>;
  /** Current speed and the speed this driver likes to keep, m/s. */
  speed: number;
  cruise: number;
  pitch: number;
  t: number;
}

/**
 * Life on the high street that isn't anybody's customer: people walking the
 * pavements (stopping now and then at a shop window) and traffic in the far lane
 * (the near lane belongs to couriers and drive-thru cars). Drivers keep their
 * distance: they ease off behind a slower car or a bus, and pull away again.
 */
export class Ambient {
  private walkers: Walker[] = [];
  private cars: Vehicle[] = [];
  private carT = 1;

  constructor(private scene: THREE.Scene, walkers = 22) {
    for (let i = 0; i < walkers; i++) this.addWalker(true);
  }

  private addWalker(anywhere: boolean) {
    const north = Math.random() < 0.55;
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const ch = new Character({ shirt: pick(LOOKS.shirts), pants: pick(LOOKS.pants), skin: pick(LOOKS.skins), hair: pick(LOOKS.hair) });
    if (Math.random() < 0.3) ch.hand.add(at(box(0.3, 0.32, 0.12, pick(['#C27552', C.cream, '#5E8C7A'])), 0.2, -0.3, -0.25));
    const z = (north ? CITY.walk.north : CITY.walk.south) + (Math.random() - 0.5) * 0.8;
    const x = anywhere ? CITY.minX + Math.random() * (CITY.maxX - CITY.minX) : dir > 0 ? CITY.minX - 4 : CITY.maxX + 4;
    ch.root.position.set(x, 0, z);
    ch.setYaw(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    this.scene.add(ch.root);
    this.walkers.push({ ch, dir, speed: 1.1 + Math.random() * 0.6, pause: 0, nextPause: 6 + Math.random() * 20, north });
  }

  private spawnCar() {
    const bus = Math.random() < 0.12;
    const v = bus ? makeBus() : makeCarModel(pick(STYLES), pick(PAINT));
    v.root.position.set(CITY.maxX + 25, 0, CITY.road.southLane);
    v.root.rotation.y = -Math.PI / 2; // heading -x
    this.scene.add(v.root);
    const cruise = bus ? 6 + Math.random() : 8 + Math.random() * 4;
    this.cars.push({ v, speed: cruise, cruise, pitch: 0, t: Math.random() * 10 });
  }

  update(dt: number) {
    for (const w of this.walkers) {
      if (w.pause > 0) {
        w.pause -= dt;
        // Turned to the shop window (or the park across the road).
        w.ch.face(0, w.north ? -1 : 1, dt * 0.5);
        w.ch.animate(dt, 0);
        if (w.pause <= 0) w.ch.face(w.dir, 0, 1);
        continue;
      }
      w.nextPause -= dt;
      if (w.nextPause <= 0) {
        w.nextPause = 10 + Math.random() * 25;
        w.pause = 2 + Math.random() * 4;
      }
      w.ch.root.position.x += w.dir * w.speed * dt;
      w.ch.face(w.dir, 0, dt);
      w.ch.animate(dt, w.speed);
    }
    const gone = this.walkers.filter((w) => w.ch.root.position.x < CITY.minX - 6 || w.ch.root.position.x > CITY.maxX + 6);
    for (const w of gone) {
      w.ch.root.removeFromParent();
      this.walkers.splice(this.walkers.indexOf(w), 1);
      this.addWalker(false);
    }

    // New traffic, when there's room at the end of the street for it.
    this.carT -= dt;
    const last = this.cars.reduce((m, c) => Math.max(m, c.v.root.position.x), -Infinity);
    if (this.carT <= 0 && last < CITY.maxX + 25 - 14) {
      this.carT = 2.5 + Math.random() * 4;
      this.spawnCar();
    }
    // Everyone heads -x: the car in front is the next one down in x.
    const order = [...this.cars].sort((a, b) => a.v.root.position.x - b.v.root.position.x);
    order.forEach((c, i) => {
      const ahead = order[i - 1];
      let target = c.cruise;
      if (ahead) {
        const gap = (c.v.root.position.x - c.v.length / 2) - (ahead.v.root.position.x + ahead.v.length / 2);
        const safe = 3 + c.speed * 0.9;
        if (gap < safe) target = Math.min(c.cruise, ahead.speed) * Math.max(0, Math.min(1, (gap - 2) / Math.max(0.1, safe - 2)));
      }
      const before = c.speed;
      const rate = target > c.speed ? 2.5 : 7;
      c.speed += Math.max(-rate * dt, Math.min(rate * dt, target - c.speed));
      const accel = (c.speed - before) / Math.max(dt, 1e-4);
      c.v.root.position.x -= c.speed * dt;
      // Nose dips under braking, squats pulling away; a little bounce on the springs.
      c.pitch += (Math.max(-0.05, Math.min(0.05, -accel * 0.008)) - c.pitch) * (1 - Math.exp(-dt * 6));
      c.t += dt;
      c.v.body.rotation.x = c.pitch;
      c.v.body.position.y = Math.sin(c.t * 12) * 0.01 * Math.min(1, c.speed / 8);
      for (const w of c.v.wheels) w.rotation.x += (c.speed * dt) / c.v.radius;
    });
    for (const c of this.cars.filter((v) => v.v.root.position.x < CITY.minX - 30)) {
      c.v.root.removeFromParent();
      this.cars.splice(this.cars.indexOf(c), 1);
    }
  }
}
