import * as THREE from 'three';
import { MARKET, MARKET_ORIGIN, SIDE_STREET } from '../config/market';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, cyl, floorDecal, mat, makeTree, roundRect } from './Assets';
import { CITY } from './layout';
import { plane } from './Level';

export interface MarketSite {
  /** Always there: hedges and gardens either side of the side street, the ground behind the shops. */
  rects: Rect[];
  /** The fenced empty lot and its board, until the market is bought… */
  lot: THREE.Group;
  /** …and the rect that keeps walkers off it. */
  lotRect: Rect;
  /** Where the "for sale" tile sits (world). */
  tile: { x: number; z: number };
}

const OX = MARKET_ORIGIN.x;
const OZ = MARKET_ORIGIN.z;

function hedge(scene: THREE.Scene, x0: number, x1: number, z0: number, z1: number) {
  const w = x1 - x0;
  const d = z1 - z0;
  const m = box(w, 0.9, d, C.leafDark);
  m.position.set((x0 + x1) / 2, 0.45, (z0 + z1) / 2);
  scene.add(m);
}

/**
 * The side street north off the high street (between the last flats and a small
 * garden), the plaza in front of the market, and the empty lot the market is built on.
 */
export function buildMarketSite(scene: THREE.Scene): MarketSite {
  const rects: Rect[] = [];
  const { x0, x1 } = SIDE_STREET;
  const top = OZ + MARKET.halfD + 0.3; // market's front wall, world z
  const kerb = CITY.northFront;

  // Paved street and plaza, lighter than the high street's asphalt: it's for walking.
  const streetLen = CITY.road.z0 - (top + 4.2);
  scene.add(at(plane(x1 - x0, streetLen + 4.2, '#CDBB9E', 0), (x0 + x1) / 2, -0.012, (top + CITY.road.z0) / 2));
  scene.add(at(plane(2 * MARKET.halfW + 1, 4.2, '#CDBB9E', 0), OX, -0.011, top + 2.1));
  for (let z = top + 5; z < CITY.road.z0 - 1; z += 2.2) scene.add(at(plane(0.9, 0.9, '#BFAB8C', 0), (x0 + x1) / 2, -0.009, z));

  // West side: a hedge from the flats to the plaza.
  hedge(scene, x0 - 0.9, x0 - 0.2, top + 4.2, kerb);
  rects.push({ x0: 79.5, x1: x0 - 0.2, z0: top + 4.2, z1: kerb });
  // East side: a small garden with trees behind a hedge.
  const gx1 = OX + MARKET.halfW + 2;
  scene.add(at(plane(gx1 - x1, kerb - (top + 4.2), '#9BB07A', 0), (x1 + gx1) / 2, -0.01, (top + 4.2 + kerb) / 2));
  hedge(scene, x1 + 0.2, x1 + 0.9, top + 4.2, kerb);
  hedge(scene, x1 + 0.2, gx1, kerb - 0.7, kerb);
  rects.push({ x0: x1 + 0.2, x1: gx1 + 2, z0: top + 4.2, z1: kerb });
  for (const [x, z] of [[95, -6], [101, -2], [107, -7], [111, 3], [97, 4]]) {
    const t = makeTree();
    t.rotation.y = x;
    scene.add(at(t, x, 0, z));
  }
  // Behind the shop row and beside the market: out of bounds.
  rects.push(
    { x0: CITY.minX - 10, x1: OX - MARKET.halfW - 0.3, z0: CITY.minZ - 10, z1: top + 4.2 },
    { x0: OX + MARKET.halfW + 0.3, x1: CITY.maxX + 5, z0: CITY.minZ - 10, z1: top + 0.3 },
    { x0: OX - MARKET.halfW - 0.3, x1: OX + MARKET.stock.x0 - 0.3, z0: CITY.minZ - 10, z1: OZ - MARKET.halfD - 0.3 },
    { x0: OX - MARKET.halfW - 0.3, x1: CITY.maxX + 5, z0: CITY.minZ - 10, z1: OZ + MARKET.stock.z0 - 0.3 },
  );

  // Wayfinding: a sign on the high-street pavement pointing up the side street.
  const arrow = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = 'rgba(47,93,140,0.92)';
    roundRect(ctx, 16, 16, 224, 224, 36);
    ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.beginPath();
    ctx.moveTo(128, 40); ctx.lineTo(186, 104); ctx.lineTo(148, 104); ctx.lineTo(148, 150);
    ctx.lineTo(108, 150); ctx.lineTo(108, 104); ctx.lineTo(70, 104);
    ctx.closePath();
    ctx.fill();
    ctx.font = '800 46px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(TR.market.sign, 128, 208);
  }).tex;
  const decal = floorDecal(arrow, 1.8);
  decal.position.set((x0 + x1) / 2, 0.02, kerb + 2.4);
  scene.add(decal);

  // The empty lot: a fence along the plaza and a board.
  const lot = new THREE.Group();
  const W = MARKET.halfW;
  lot.add(at(plane(2 * W, 2 * MARKET.halfD, '#CDB99A', 0), OX, 0.003, OZ));
  for (let x = -W; x <= W; x += 1.6) lot.add(at(box(0.08, 0.7, 0.08, C.woodDark), OX + x, 0.35, top - 0.2));
  lot.add(at(box(2 * W, 0.06, 0.06, C.woodDark), OX, 0.6, top - 0.2));
  const tex = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 496, 240, 28);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#2F5D8C';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2F5D8C';
    ctx.font = '800 84px "Baloo 2", sans-serif';
    ctx.fillText(TR.city.forSale, 256, 118);
    ctx.fillStyle = C.dark;
    ctx.font = '700 40px "Baloo 2", sans-serif';
    ctx.fillText(TR.market.forSaleSub, 256, 190);
  }).tex;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  board.position.set(OX + 4, 2.1, top - 0.9);
  lot.add(board, at(box(3.2, 1.7, 0.1, C.woodDark), OX + 4, 2.1, top - 0.97));
  lot.add(at(cyl(0.07, 0.07, 1.4, 6, C.woodDark), OX + 2.8, 0.7, top - 1), at(cyl(0.07, 0.07, 1.4, 6, C.woodDark), OX + 5.2, 0.7, top - 1));
  const pile = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), mat('#B8A07E'));
  pile.scale.y = 0.4;
  lot.add(at(pile, OX - 6, 0.2, OZ + 2));
  scene.add(lot);

  return {
    rects,
    lot,
    lotRect: { x0: OX - W - 0.3, x1: OX + W + 0.3, z0: OZ + MARKET.stock.z0, z1: top - 0.1 },
    tile: { x: OX - 6, z: top + 2 },
  };
}
