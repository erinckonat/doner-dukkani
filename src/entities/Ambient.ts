import * as THREE from 'three';
import { at, box, C, cyl, mat } from '../world/Assets';
import { CITY } from '../world/layout';
import { Character, LOOKS, pick } from './Character';

const PAINT = ['#B8473A', '#3F6E8C', '#E0B04A', '#5E8C5A', '#D9D2C5', '#4A4550', '#8C5A7A', '#2F3A44'];

interface Walker { ch: Character; dir: 1 | -1; speed: number; z: number }
interface Vehicle { root: THREE.Group; wheels: THREE.Object3D[]; speed: number }

function makeTrafficCar(bus: boolean) {
  const root = new THREE.Group();
  const paint = bus ? C.gold : pick(PAINT);
  const len = bus ? 7.5 : 3.2;
  const h = bus ? 1.9 : 0.55;
  // Built facing +x: the lane runs along the street.
  root.add(at(box(len, h, 1.7, paint), 0, 0.35 + h / 2, 0));
  if (bus) {
    for (let i = 0; i < 5; i++) root.add(at(new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 1.72), mat('#2F3A44', '#7FA7C0', 0.15)), -2.8 + i * 1.3, 1.65, 0));
  } else {
    root.add(at(box(1.7, 0.5, 1.5, paint), -0.15, 1.07, 0));
    root.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.36, 1.42), mat('#2F3A44', '#7FA7C0', 0.15)), -0.15, 1.08, 0));
  }
  const wheels: THREE.Object3D[] = [];
  for (const x of [-len / 2 + 0.8, len / 2 - 0.8]) {
    for (const z of [-0.82, 0.82]) {
      const w = cyl(0.32, 0.32, 0.22, 10, C.dark);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.32, z);
      root.add(w);
      wheels.push(w);
    }
  }
  return { root, wheels };
}

/**
 * Life on the high street that isn't anybody's customer: people walking the
 * pavements and traffic in the far lane (the near lane belongs to couriers and
 * drive-thru cars).
 */
export class Ambient {
  private walkers: Walker[] = [];
  private cars: Vehicle[] = [];
  private carT = 1;

  constructor(private scene: THREE.Scene, walkers = 14) {
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
    this.walkers.push({ ch, dir, speed: 1.1 + Math.random() * 0.6, z });
  }

  update(dt: number) {
    for (const w of this.walkers) {
      w.ch.root.position.x += w.dir * w.speed * dt;
      w.ch.animate(dt, w.speed);
    }
    const gone = this.walkers.filter((w) => w.ch.root.position.x < CITY.minX - 6 || w.ch.root.position.x > CITY.maxX + 6);
    for (const w of gone) {
      w.ch.root.removeFromParent();
      this.walkers.splice(this.walkers.indexOf(w), 1);
      this.addWalker(false);
    }

    this.carT -= dt;
    if (this.carT <= 0) {
      this.carT = 2.5 + Math.random() * 4;
      const { root, wheels } = makeTrafficCar(Math.random() < 0.12);
      root.position.set(CITY.maxX + 25, 0, CITY.road.southLane);
      root.rotation.y = Math.PI; // heading -x
      this.scene.add(root);
      this.cars.push({ root, wheels, speed: 7 + Math.random() * 3 });
    }
    for (const c of this.cars) {
      c.root.position.x -= c.speed * dt;
      for (const w of c.wheels) w.rotation.y += (c.speed * dt) / 0.32;
    }
    for (const c of this.cars.filter((v) => v.root.position.x < CITY.minX - 30)) {
      c.root.removeFromParent();
      this.cars.splice(this.cars.indexOf(c), 1);
    }
  }
}
