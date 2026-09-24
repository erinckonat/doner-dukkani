import * as THREE from 'three';
import { BUSINESSES, type BusinessDef } from '../config/city';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, cyl, floorDecal, mat, makeTree, roundRect } from './Assets';
import { CITY, SHOP_ORIGIN_X } from './layout';
import { plane } from './Level';

export interface BusinessPad {
  biz: BusinessDef;
  /** Where to stand (world) to go in. */
  pos: THREE.Vector3;
}

export interface CityRefs {
  rects: Rect[];
  pads: BusinessPad[];
  /** The "for sale" plot next door; removed once the burger shop opens. */
  plot: THREE.Group;
  /** Barber poles to spin. */
  spinners: THREE.Object3D[];
}

const DEPTH = 10;
const FLOOR_H = 3;

/** Street-facing facade: shopfront glass and door below, windows on the floors above. */
function facadeTexture(biz: BusinessDef) {
  const pxPerM = 40;
  const w = Math.round(biz.w * pxPerM);
  const h = Math.round(biz.floors * FLOOR_H * pxPerM);
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = biz.facade;
    ctx.fillRect(0, 0, w, h);
    const floorPx = FLOOR_H * pxPerM;
    // Upper floors: a row of windows each.
    for (let f = 1; f < biz.floors; f++) {
      const y = h - (f + 1) * floorPx;
      const n = Math.max(2, Math.floor(biz.w / 2.2));
      const gap = w / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = 'rgba(42,30,24,0.18)';
        ctx.fillRect(i * gap + gap * 0.22, y + floorPx * 0.22, gap * 0.56, floorPx * 0.5);
        ctx.fillStyle = '#6F8FA8';
        ctx.fillRect(i * gap + gap * 0.26, y + floorPx * 0.26, gap * 0.48, floorPx * 0.42);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(i * gap + gap * 0.26, y + floorPx * 0.26, gap * 0.12, floorPx * 0.42);
      }
    }
    // Ground floor: shopfront glass either side of a central door.
    const gy = h - floorPx;
    const isShop = biz.kind !== 'flats';
    ctx.fillStyle = isShop ? '#3F5566' : '#6F8FA8';
    if (isShop) {
      ctx.fillRect(w * 0.06, gy + floorPx * 0.25, w * 0.34, floorPx * 0.65);
      ctx.fillRect(w * 0.6, gy + floorPx * 0.25, w * 0.34, floorPx * 0.65);
      ctx.fillStyle = 'rgba(255,240,200,0.28)';
      ctx.fillRect(w * 0.08, gy + floorPx * 0.28, w * 0.1, floorPx * 0.58);
      ctx.fillRect(w * 0.62, gy + floorPx * 0.28, w * 0.1, floorPx * 0.58);
    }
    ctx.fillStyle = biz.accent;
    ctx.fillRect(w * 0.43, gy + floorPx * 0.2, w * 0.14, floorPx * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(w * 0.45, gy + floorPx * 0.25, w * 0.1, floorPx * 0.35);
  });
}

function signTexture(biz: BusinessDef) {
  return canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = biz.accent;
    roundRect(ctx, 4, 4, 504, 120, 24);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = TR.city.name[biz.id as keyof typeof TR.city.name] ?? '';
    let size = 64;
    do ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
    while (ctx.measureText(name).width > 470 && (size -= 4) > 28);
    ctx.fillText(name, 256, 70);
  }).tex;
}

/** A building in the row, its front on CITY.northFront facing the street (+z). */
function buildBusiness(scene: THREE.Scene, biz: BusinessDef, rects: Rect[], spinners: THREE.Object3D[]) {
  const front = CITY.northFront;
  const height = biz.floors * FLOOR_H;
  const g = new THREE.Group();
  g.position.set(biz.x, 0, front - DEPTH / 2);
  const fz = DEPTH / 2; // local z of the facade
  const body = box(biz.w, height, DEPTH, biz.facade);
  body.position.y = height / 2;
  g.add(body);
  g.add(at(box(biz.w + 0.3, 0.3, DEPTH + 0.3, biz.accent), 0, height + 0.15, 0));
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(biz.w, height),
    new THREE.MeshStandardMaterial({ map: facadeTexture(biz).tex, roughness: 0.9 }),
  );
  face.position.set(0, height / 2, fz + 0.02);
  g.add(face);

  if (biz.kind !== 'flats') {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(biz.w - 1, 6), 1.5), new THREE.MeshStandardMaterial({ map: signTexture(biz), roughness: 0.8 }));
    sign.position.set(0, FLOOR_H + 0.35, fz + 0.12);
    g.add(sign);
  }
  if (biz.kind === 'cafe' || biz.kind === 'pide' || biz.kind === 'barber') {
    // Striped awning over the shopfront.
    const stripes = Math.round(biz.w / 0.6);
    for (let i = 0; i < stripes; i++) {
      const s = box(biz.w / stripes, 0.06, 1.3, i % 2 ? C.cream : biz.accent);
      s.position.set(-biz.w / 2 + (i + 0.5) * (biz.w / stripes), FLOOR_H - 0.35, fz + 0.6);
      s.rotation.x = -0.32;
      g.add(s);
    }
  }
  if (biz.kind === 'barber') {
    // The classic spinning barber pole.
    const pole = new THREE.Group();
    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      const band = cyl(0.12, 0.12, 0.2, 10, i % 2 ? C.cream : i % 4 ? '#2F5D8C' : C.primary);
      band.position.y = i * 0.2;
      band.rotation.z = 0.25;
      pole.add(band);
    }
    pole.position.set(biz.w / 2 - 0.6, 0.9, fz + 0.3);
    g.add(pole);
    spinners.push(pole);
  }
  if (biz.kind === 'cafe') {
    // Two little tables out front.
    for (const dx of [-biz.w / 2 + 1.1, biz.w / 2 - 1.1]) {
      g.add(at(cyl(0.35, 0.35, 0.05, 8, C.cream), dx, 0.72, fz + 1.1));
      g.add(at(cyl(0.05, 0.05, 0.7, 6, C.woodDark), dx, 0.35, fz + 1.1));
    }
  }
  scene.add(g);
  rects.push({ x0: biz.x - biz.w / 2, x1: biz.x + biz.w / 2, z0: front - DEPTH, z1: front });
}

/** "Enter" ring on the pavement in front of a business door. */
function padDecal() {
  const { tex } = canvasTexture(256, 256, (ctx) => {
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,250,240,0.6)';
    ctx.fill();
    ctx.setLineDash([26, 16]);
    ctx.lineWidth = 10;
    ctx.strokeStyle = C.dark;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.dark;
    ctx.font = '800 64px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TR.city.enter, 128, 136);
  });
  return floorDecal(tex, 1.5);
}

function lamp(x: number, z: number) {
  const g = new THREE.Group();
  g.add(at(cyl(0.06, 0.08, 3.4, 6, '#3A3530'), 0, 1.7, 0));
  g.add(at(box(0.5, 0.08, 0.12, '#3A3530'), 0.2, 3.4, 0));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), mat(C.cream, C.gold, 0.6)), 0.4, 3.32, 0));
  g.position.set(x, 0, z);
  return g;
}

/** The for-sale plot next door, waiting to become the burger shop. */
function buildPlot(scene: THREE.Scene) {
  const g = new THREE.Group();
  const ox = SHOP_ORIGIN_X.burger;
  g.add(at(plane(20, 18, '#CDB99A', 0), ox, 0.002, 0));
  for (let i = -9; i <= 9; i += 1.5) g.add(at(box(0.08, 0.7, 0.08, C.woodDark), ox + i, 0.35, 9.1));
  g.add(at(box(18.2, 0.06, 0.06, C.woodDark), ox, 0.6, 9.1));
  const tex = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 496, 240, 28);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = C.primary;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.primary;
    ctx.font = '800 84px "Baloo 2", sans-serif';
    ctx.fillText(TR.city.forSale, 256, 118);
    ctx.fillStyle = C.dark;
    ctx.font = '700 40px "Baloo 2", sans-serif';
    ctx.fillText(TR.city.forSaleSub, 256, 190);
  }).tex;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  board.position.set(ox + 4, 2.1, 8.3);
  g.add(board, at(box(3.2, 1.7, 0.1, C.woodDark), ox + 4, 2.1, 8.23));
  g.add(at(cyl(0.07, 0.07, 1.4, 6, C.woodDark), ox + 2.8, 0.7, 8.2), at(cyl(0.07, 0.07, 1.4, 6, C.woodDark), ox + 5.2, 0.7, 8.2));
  scene.add(g);
  return g;
}

export function buildCity(scene: THREE.Scene): CityRefs {
  const rects: Rect[] = [];
  const pads: BusinessPad[] = [];
  const spinners: THREE.Object3D[] = [];
  const { minX, maxX, road } = CITY;
  const width = maxX - minX + 80;
  const cx = (minX + maxX) / 2;

  // Paving everywhere, then the high street on top.
  scene.add(at(plane(width, 170, '#D8C8AE', 0), cx, -0.02, -20));
  const roadW = road.z1 - road.z0;
  const roadZ = (road.z0 + road.z1) / 2;
  scene.add(at(plane(width, roadW, '#6E6258', 0), cx, -0.01, roadZ));
  for (let x = minX - 40; x < maxX + 40; x += 3) scene.add(at(plane(1.4, 0.16, '#EFE4CF', 0), x, -0.005, roadZ));
  for (const z of [road.z0 - 0.15, road.z1 + 0.15]) scene.add(at(plane(width, 0.3, '#B8A68B', 0), cx, -0.004, z));
  // Zebra crossing between the shops and the café/pide side.
  for (let i = 0; i < 7; i++) scene.add(at(plane(0.5, roadW - 0.4, '#EFE4CF', 0), 12 + i * 0.9 - 2.7, -0.004, roadZ));
  // Across the road: a low park strip (anything tall here would stand between camera and street).
  const parkZ0 = road.z1 + 1.6;
  scene.add(at(plane(width, 16, '#9BB07A', 0), cx, -0.015, parkZ0 + 8));
  for (let x = minX + 6; x < maxX; x += 9) {
    const bench = new THREE.Group();
    bench.add(at(box(1.6, 0.08, 0.45, C.woodLight), 0, 0.45, 0), at(box(1.6, 0.4, 0.08, C.woodLight), 0, 0.7, 0.2));
    bench.add(at(box(0.08, 0.45, 0.4, '#3A3530'), -0.7, 0.22, 0), at(box(0.08, 0.45, 0.4, '#3A3530'), 0.7, 0.22, 0));
    bench.position.set(x, 0, parkZ0 + 0.6);
    bench.rotation.y = Math.PI;
    scene.add(bench);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mat(x % 2 ? C.leaf : C.leafDark));
    bush.position.set(x + 4.5, 0.45, parkZ0 + 1.4);
    bush.castShadow = true;
    scene.add(bush);
    rects.push({ x0: x - 0.8, x1: x + 0.8, z0: parkZ0 + 0.35, z1: parkZ0 + 0.85 });
  }

  for (const biz of BUSINESSES) {
    buildBusiness(scene, biz, rects, spinners);
    // The bank has no activity: its door opens the stock exchange.
    if (biz.activities.length || biz.kind === 'bank') {
      const pos = new THREE.Vector3(biz.x, 0, CITY.northFront + 1.1);
      const d = padDecal();
      d.position.set(pos.x, 0.03, pos.z);
      scene.add(d);
      pads.push({ biz, pos });
    }
  }

  // Street furniture: lamps on both kerbs, trees on the shop side clear of the doors.
  for (let x = minX + 4; x < maxX; x += 12) {
    scene.add(lamp(x, road.z0 - 0.6), lamp(x + 6, road.z1 + 0.6));
    rects.push({ x0: x - 0.1, x1: x + 0.1, z0: road.z0 - 0.7, z1: road.z0 - 0.5 });
  }
  for (const x of [-46, -34, -13, 12, 24, 46, 59]) {
    const t = makeTree();
    t.rotation.y = x;
    scene.add(at(t, x, 0, 13.8));
    rects.push({ x0: x - 0.3, x1: x + 0.3, z0: 13.5, z1: 14.1 });
  }

  return { rects, pads, plot: buildPlot(scene), spinners };
}
