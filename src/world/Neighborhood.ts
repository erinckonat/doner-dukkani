import * as THREE from 'three';
import { ESTATE_OFFICE, PROPERTIES, type PropertyDef } from '../config/estate';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, floorDecal, makePlant, makeTree, roundRect } from './Assets';
import { CITY } from './layout';
import { plane } from './Level';

const FLOOR_H = 3;

export interface EstatePad {
  /** A property's door, or the estate office. */
  prop?: PropertyDef;
  office?: boolean;
  pos: THREE.Vector3;
}

/** Ring on the pavement in front of a door, with a word in the middle. */
export function padRing(word: string, colour: string = C.dark) {
  const { tex } = canvasTexture(256, 256, (ctx) => {
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,250,240,0.6)';
    ctx.fill();
    ctx.setLineDash([26, 16]);
    ctx.lineWidth = 10;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.font = '800 56px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, 128, 136);
  });
  return floorDecal(tex, 1.5);
}

/** Windows on a flat wall, `floors` rows of them. */
function wallTexture(w: number, floors: number, wall: string, door: string) {
  const px = 40;
  const W = Math.round(w * px);
  const Hh = Math.round(floors * FLOOR_H * px);
  return canvasTexture(W, Hh, (ctx) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, Hh);
    const fp = FLOOR_H * px;
    for (let f = 0; f < floors; f++) {
      const y = Hh - (f + 1) * fp;
      const n = Math.max(2, Math.floor(w / 2.4));
      const gap = W / n;
      for (let i = 0; i < n; i++) {
        if (f === 0 && Math.abs(i - (n - 1) / 2) < 0.6) continue; // the door's place
        ctx.fillStyle = 'rgba(42,30,24,0.2)';
        ctx.fillRect(i * gap + gap * 0.22, y + fp * 0.24, gap * 0.56, fp * 0.5);
        ctx.fillStyle = '#6F8FA8';
        ctx.fillRect(i * gap + gap * 0.26, y + fp * 0.28, gap * 0.48, fp * 0.42);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(i * gap + gap * 0.26, y + fp * 0.28, gap * 0.12, fp * 0.42);
      }
    }
    ctx.fillStyle = door;
    ctx.fillRect(W * 0.43, Hh - fp * 0.8, W * 0.14, fp * 0.8);
  }).tex;
}

/** A detached house set back behind its garden: walls, a pitched roof, a hedge and a gate. */
function buildHouse(scene: THREE.Scene, d: PropertyDef, rects: Rect[]) {
  const front = CITY.northFront;
  const g = new THREE.Group();
  const depth = 7;
  const z1 = front - 3; // the house front; a 3 m garden before the pavement
  const h = d.floors * FLOOR_H;
  g.add(at(box(d.w - 1, h, depth, d.wall!), d.x, h / 2, z1 - depth / 2));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(d.w - 1, h), new THREE.MeshStandardMaterial({ map: wallTexture(d.w - 1, d.floors, d.wall!, '#6E4128'), roughness: 0.9 }));
  face.position.set(d.x, h / 2, z1 + 0.02);
  g.add(face);
  // Pitched roof: two slopes meeting over the middle, eaves a little proud of the walls.
  const slope = Math.PI / 6;
  const half = depth / 2 + 0.4;
  for (const side of [1, -1]) {
    const plank = box(d.w - 0.4, 0.14, half / Math.cos(slope), d.roof!);
    plank.position.set(d.x, h + (half * Math.tan(slope)) / 2, z1 - depth / 2 + side * (half / 2));
    plank.rotation.x = side * slope;
    g.add(plank);
  }
  // Gable ends: a triangle of wall under each end of the roof.
  const tri = new THREE.Shape([new THREE.Vector2(-depth / 2, 0), new THREE.Vector2(depth / 2, 0), new THREE.Vector2(0, (depth / 2) * Math.tan(slope))]);
  for (const side of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshStandardMaterial({ color: d.wall, side: THREE.DoubleSide }));
    gable.rotation.y = Math.PI / 2;
    gable.position.set(d.x + side * (d.w - 1) / 2, h, z1 - depth / 2);
    g.add(gable);
  }
  // Garden: grass, a hedge with a gap for the gate, a tree.
  g.add(at(plane(d.w, 3, '#9BB07A', 0), d.x, 0.004, front - 1.5));
  for (const [x0, x1] of [[d.x - d.w / 2, d.x - 0.8], [d.x + 0.8, d.x + d.w / 2]]) {
    g.add(at(box(x1 - x0, 0.7, 0.4, C.leafDark), (x0 + x1) / 2, 0.35, front - 0.25));
  }
  g.add(at(box(1.5, 0.05, 3, '#CDBB9E'), d.x, 0.02, front - 1.5));
  const t = makeTree();
  t.rotation.y = d.x;
  g.add(at(t, d.x + d.w / 2 - 1.3, 0, front - 1.6));
  scene.add(g);
  rects.push({ x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: front - 10, z1: front });
}

/** A block of flats, straight onto the pavement like the old ones on the street. */
function buildFlats(scene: THREE.Scene, d: PropertyDef, rects: Rect[]) {
  const front = CITY.northFront;
  const h = d.floors * FLOOR_H;
  const g = new THREE.Group();
  g.add(at(box(d.w, h, 10, d.wall!), d.x, h / 2, front - 5));
  g.add(at(box(d.w + 0.3, 0.3, 10.3, '#8A6A4A'), d.x, h + 0.15, front - 5));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(d.w, h), new THREE.MeshStandardMaterial({ map: wallTexture(d.w, d.floors, d.wall!, '#3A3F4A'), roughness: 0.9 }));
  face.position.set(d.x, h / 2, front + 0.02);
  g.add(face);
  const nameTex = canvasTexture(512, 96, (ctx) => {
    ctx.fillStyle = '#3A3F4A';
    roundRect(ctx, 4, 4, 504, 88, 20);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.font = '800 52px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.name, 256, 52);
  }).tex;
  const name = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64), new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.8 }));
  name.position.set(d.x, FLOOR_H + 0.1, front + 0.06);
  g.add(name);
  scene.add(g);
  rects.push({ x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: front - 10, z1: front });
}

/**
 * Lale Mahallesi at the west end of the high street: new houses and blocks of flats
 * (all for sale), the estate office, and the pads at every property's door —
 * including the two old blocks of flats on the street.
 */
export function buildNeighborhood(scene: THREE.Scene) {
  const rects: Rect[] = [];
  const pads: EstatePad[] = [];
  const front = CITY.northFront;
  for (const d of PROPERTIES) {
    if (d.kind === 'house') buildHouse(scene, d, rects);
    else if (d.kind === 'flats' && d.wall) buildFlats(scene, d, rects);
    if (d.kind === 'shop') continue; // shops use their own door ring
    const pos = new THREE.Vector3(d.x, 0, front + 1.1);
    const ring = padRing(TR.estate.ring);
    ring.position.set(pos.x, 0.03, pos.z);
    scene.add(ring);
    pads.push({ prop: d, pos });
  }
  // The estate office: a small shopfront with a sign.
  const O = ESTATE_OFFICE;
  const g = new THREE.Group();
  g.add(at(box(O.w, 3.4, 8, '#E9E4DA'), O.x, 1.7, front - 4));
  g.add(at(box(O.w + 0.3, 0.3, 8.3, '#2F5D8C'), O.x, 3.55, front - 4));
  g.add(at(box(O.w - 1.6, 1.8, 0.06, '#6F8FA8', false), O.x, 1.3, front + 0.02));
  const sign = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = '#2F5D8C';
    roundRect(ctx, 4, 4, 504, 120, 24);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.font = '800 60px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TR.estate.office, 256, 70);
  }).tex;
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(O.w - 1, 1.3), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.8 }));
  sm.position.set(O.x, 2.7, front + 0.08);
  g.add(sm);
  g.add(at(makePlant(), O.x - O.w / 2 + 0.6, 0, front + 0.5));
  scene.add(g);
  rects.push({ x0: O.x - O.w / 2, x1: O.x + O.w / 2, z0: front - 8, z1: front }, { x0: O.x - O.w / 2 + 0.3, x1: O.x - O.w / 2 + 0.9, z0: front + 0.2, z1: front + 0.8 });
  const opos = new THREE.Vector3(O.x + 1, 0, front + 1.1);
  const ring = padRing(TR.estate.officeRing, '#2F5D8C');
  ring.position.set(opos.x, 0.03, opos.z);
  scene.add(ring);
  pads.push({ office: true, pos: opos });
  // The neighbourhood's name on the pavement where it starts.
  const name = canvasTexture(768, 160, (ctx) => {
    ctx.fillStyle = 'rgba(62,107,90,0.92)';
    roundRect(ctx, 8, 8, 752, 144, 36);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.font = '800 84px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TR.estate.hood, 384, 86);
  }).tex;
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.1), new THREE.MeshBasicMaterial({ map: name, transparent: true, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(-109, 0.02, front + 3.2);
  scene.add(mark);
  return { rects, pads };
}

/** The car gallery's plot, fenced with a board until it's bought. */
export function buildGalleryLot(scene: THREE.Scene, ox: number, oz: number, halfW: number, halfD: number) {
  const lot = new THREE.Group();
  const front = oz + halfD + 0.3;
  lot.add(at(plane(2 * halfW, 2 * halfD, '#CDB99A', 0), ox, 0.003, oz));
  for (let x = -halfW; x <= halfW; x += 1.6) lot.add(at(box(0.08, 0.8, 0.08, C.woodDark), ox + x, 0.4, front - 0.2));
  lot.add(at(box(2 * halfW, 0.06, 0.06, C.woodDark), ox, 0.7, front - 0.2));
  const tex = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 496, 240, 28);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1F2A3A';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1F2A3A';
    ctx.font = '800 84px "Baloo 2", sans-serif';
    ctx.fillText(TR.city.forSale, 256, 118);
    ctx.fillStyle = C.dark;
    ctx.font = '700 40px "Baloo 2", sans-serif';
    ctx.fillText(TR.gallery.forSaleSub, 256, 190);
  }).tex;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  board.position.set(ox + 4, 2.1, front - 0.9);
  lot.add(board, at(box(3.2, 1.7, 0.1, C.woodDark), ox + 4, 2.1, front - 0.97));
  scene.add(lot);
  return { lot, lotRect: { x0: ox - halfW - 0.3, x1: ox + halfW + 0.3, z0: oz - halfD - 0.3, z1: front - 0.1 } as Rect, tile: { x: ox, z: front + 2.4 } };
}
