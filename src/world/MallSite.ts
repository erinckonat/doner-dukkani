import * as THREE from 'three';
import { MALL, MALL_ORIGIN } from '../config/mall';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, cyl, mat, roundRect } from './Assets';
import { CITY } from './layout';
import { plane } from './Level';

export interface MallSite {
  /** Always there: the ground around the mall's plot that nobody walks on. */
  rects: Rect[];
  /** The fenced building site and its board, until the mall is bought… */
  lot: THREE.Group;
  /** …and the rect that keeps walkers off it. */
  lotRect: Rect;
  /** Where the "for sale" tile sits (world). */
  tile: { x: number; z: number };
}

const OX = MALL_ORIGIN.x;
const OZ = MALL_ORIGIN.z;

/** East of the hotel: a fenced lot with a board, and the edges of the plot either way. */
export function buildMallSite(scene: THREE.Scene): MallSite {
  const { halfW: W, halfD: D } = MALL;
  const front = OZ + D + 0.3;
  const rects: Rect[] = [
    // The strip between the hotel's garden and the mall, behind it, and east of it.
    { x0: 120, x1: OX - W - 0.3, z0: CITY.minZ - 10, z1: CITY.northFront },
    { x0: 116, x1: CITY.maxX + 5, z0: CITY.minZ - 10, z1: OZ - D - 0.3 },
    { x0: OX + W + 0.3, x1: CITY.maxX + 5, z0: CITY.minZ - 10, z1: CITY.northFront },
  ];

  const lot = new THREE.Group();
  lot.add(at(plane(2 * W, 2 * D, '#CDB99A', 0), OX, 0.003, OZ));
  for (let x = -W; x <= W; x += 1.6) lot.add(at(box(0.08, 0.9, 0.08, C.woodDark), OX + x, 0.45, front - 0.2));
  lot.add(at(box(2 * W, 0.06, 0.06, C.woodDark), OX, 0.75, front - 0.2));
  // A crane and some rubble, so it reads as a building site.
  lot.add(at(box(0.6, 12, 0.6, '#E3A64A'), OX + 12, 6, OZ - 6));
  lot.add(at(box(14, 0.5, 0.5, '#E3A64A'), OX + 17, 12, OZ - 6));
  for (const [x, z] of [[-14, -4], [-4, 6], [8, 10]] as const) {
    const pile = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 0), mat('#B8A07E'));
    pile.scale.y = 0.4;
    lot.add(at(pile, OX + x, 0.25, OZ + z));
  }
  const tex = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 496, 240, 28);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#2E3A55';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2E3A55';
    ctx.font = '800 84px "Baloo 2", sans-serif';
    ctx.fillText(TR.city.forSale, 256, 118);
    ctx.fillStyle = C.dark;
    ctx.font = '700 38px "Baloo 2", sans-serif';
    ctx.fillText(TR.mall.forSaleSub, 256, 190);
  }).tex;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  board.position.set(OX + 5, 2.1, front - 0.9);
  lot.add(board, at(box(3.2, 1.7, 0.1, C.woodDark), OX + 5, 2.1, front - 0.97));
  lot.add(at(cyl(0.07, 0.07, 1.4, 6, C.woodDark), OX + 3.8, 0.7, front - 1), at(cyl(0.07, 0.07, 1.4, 6, C.woodDark), OX + 6.2, 0.7, front - 1));
  scene.add(lot);

  return {
    rects,
    lot,
    lotRect: { x0: OX - W - 0.3, x1: OX + W + 0.3, z0: OZ - D - 0.3, z1: front - 0.1 },
    tile: { x: OX, z: front + 2.6 },
  };
}
