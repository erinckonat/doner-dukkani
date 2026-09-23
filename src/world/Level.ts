import * as THREE from 'three';
import type { Rect } from '../core/Nav';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, cyl, drawDonerIcon, makePlant, makeTree, roundRect } from './Assets';
import { BURGER_GATE, DOOR, DRIVE_ROAD, ROOM } from './layout';

export interface LevelRefs {
  rects: Rect[];
  windowWall: THREE.Object3D;
}

const WALL = 0.3;

function plane(w: number, d: number, color: string | THREE.Texture, y: number) {
  const material = typeof color === 'string'
    ? new THREE.MeshStandardMaterial({ color, roughness: 1 })
    : new THREE.MeshStandardMaterial({ map: color, roughness: 1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function wall(scene: THREE.Scene, rects: Rect[], r: Rect, h: number, color: string) {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const m = box(w, h, d, color);
  m.position.set((r.x0 + r.x1) / 2, h / 2, (r.z0 + r.z1) / 2);
  scene.add(m);
  const cap = box(w + 0.06, 0.08, d + 0.06, C.woodDark, false);
  cap.position.set(m.position.x, h + 0.04, m.position.z);
  scene.add(cap);
  rects.push(r);
  return m;
}

export function buildLevel(scene: THREE.Scene): LevelRefs {
  const rects: Rect[] = [];
  const { minX, maxX, minZ, maxZ } = ROOM;

  // Ground outside, road, grass.
  scene.add(plane(90, 90, '#D8C8AE', -0.02));
  scene.add(at(plane(90, 5, '#7A6C60', -0.01), 0, -0.01, 17.6));
  for (let x = -40; x < 40; x += 3) scene.add(at(plane(1.4, 0.2, '#EFE4CF', 0), x, -0.005, 17.6));
  scene.add(at(plane(90, 0.3, '#BBA98E', 0), 0, -0.005, 15));
  scene.add(at(plane(6, 7, '#9BB07A', 0), 14.5, -0.008, -4));
  scene.add(at(plane(5, 9, '#9BB07A', 0), -18.5, -0.008, -5));

  // Drive-thru road along the left wall, joining the street in front.
  const { x0, x1 } = DRIVE_ROAD;
  const roadX = (x0 + x1) / 2;
  scene.add(at(plane(x1 - x0, 120, '#7A6C60', 0), roadX, -0.012, 0));
  for (const x of [x0 + 0.12, x1 - 0.12]) scene.add(at(plane(0.1, 120, '#EFE4CF', 0), x, -0.009, 0));
  const stopMark = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#EFE4CF';
    ctx.fillRect(0, 0, 512, 14);
    ctx.font = '800 76px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TR.driveMark, 256, 140);
  }).tex;
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: stopMark, transparent: true, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2;
  mark.rotation.z = Math.PI / 2;
  mark.position.set(roadX, 0.01, 5.4);
  scene.add(mark);

  // Checker floor inside.
  const floor = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#EFE2CB';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#E4D0B0';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);
  }).tex;
  floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
  floor.repeat.set((maxX - minX) / 2, (maxZ - minZ) / 2);
  scene.add(at(plane(maxX - minX, maxZ - minZ, floor, 0), 0, 0, 0));

  // Kitchen zone behind the counter.
  scene.add(at(plane(10, 6.5, '#D8C0A0', 0.004), -5, 0.004, -5.75));
  scene.add(at(plane(10, 0.08, C.primary, 0.006), -5, 0.006, -2.5));

  // Walls: tall at the back, low at the sides, knee-high in front so the camera sees in.
  const back = wall(scene, rects, { x0: minX - WALL, x1: maxX + WALL, z0: minZ - WALL, z1: minZ }, 2.6, '#EAD7BD');
  back.castShadow = false;
  const stripe = box(maxX - minX, 0.14, 0.04, C.primary, false);
  stripe.position.set(0, 1.1, minZ + 0.02);
  scene.add(stripe);
  wall(scene, rects, { x0: minX - WALL, x1: minX, z0: minZ, z1: 2 }, 1.3, '#E3CCAE');
  wall(scene, rects, { x0: minX - WALL, x1: minX, z0: 4, z1: maxZ }, 1.3, '#E3CCAE');
  wall(scene, rects, { x0: maxX, x1: maxX + WALL, z0: minZ, z1: maxZ }, 1.3, '#E3CCAE');
  wall(scene, rects, { x0: minX - WALL, x1: DOOR.x0, z0: maxZ, z1: maxZ + WALL }, 0.5, '#E3CCAE');
  wall(scene, rects, { x0: DOOR.x1, x1: maxX + WALL, z0: maxZ, z1: maxZ + WALL }, 0.5, '#E3CCAE');

  // Window gap on the left wall is always solid: wall until unlocked, counter after.
  const windowWall = box(WALL, 1.3, 2, '#E3CCAE');
  windowWall.position.set(minX - WALL / 2, 0.65, 3);
  scene.add(windowWall);
  rects.push({ x0: -10.4, x1: -9.6, z0: 2, z1: 4 });

  // Door mat.
  scene.add(at(plane(3, 1.2, C.primary, 0.006), 0, 0.006, maxZ - 0.7));

  // Shop sign on the back wall.
  const sign = canvasTexture(1024, 192, (ctx) => {
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 1008, 176, 40);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = C.primary;
    ctx.stroke();
    drawDonerIcon(ctx, 120, 96, 56);
    drawDonerIcon(ctx, 904, 96, 56);
    ctx.fillStyle = C.primary;
    ctx.font = '800 108px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TR.title.toLocaleUpperCase('tr-TR'), 512, 104);
  }).tex;
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.9 }));
  signMesh.position.set(-3, 3.3, minZ - 0.1);
  scene.add(signMesh);
  scene.add(at(box(6.7, 1.45, 0.12, C.woodDark), -3, 3.3, minZ - 0.2));

  // Plants and trees.
  for (const [x, z] of [[9.3, 8.3], [-9.3, 8.3], [9.3, -8.3]] as const) {
    scene.add(at(makePlant(), x, 0, z));
    rects.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
  }
  for (const [x, z] of [[-16.5, -6], [12.5, -6], [12.5, 2.5], [-16.5, 8.5], [-17, -1.5], [13, 8]] as const) {
    const t = makeTree();
    t.rotation.y = x * z;
    scene.add(at(t, x, 0, z));
    rects.push({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 });
  }

  // Next-business teaser sign.
  const [gx, gz] = BURGER_GATE;
  const gate = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 496, 240, 32);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = C.gold;
    ctx.stroke();
    ctx.fillStyle = C.dark;
    ctx.textAlign = 'center';
    ctx.font = '800 64px "Baloo 2", sans-serif';
    ctx.fillText(TR.burgerName, 256, 118);
    ctx.fillStyle = C.primary;
    ctx.font = '700 44px "Baloo 2", sans-serif';
    ctx.fillText(TR.soon, 256, 190);
  }).tex;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshStandardMaterial({ map: gate, roughness: 0.9 }));
  board.position.set(gx, 2.3, gz - 0.9);
  scene.add(board);
  scene.add(at(box(3.2, 1.7, 0.1, C.woodDark), gx, 2.3, gz - 0.97));
  scene.add(at(cyl(0.07, 0.07, 1.5, 6, C.woodDark), gx - 1.2, 0.75, gz - 1), at(cyl(0.07, 0.07, 1.5, 6, C.woodDark), gx + 1.2, 0.75, gz - 1));
  rects.push({ x0: gx - 1.6, x1: gx + 1.6, z0: gz - 1.1, z1: gz - 0.85 });

  return { rects, windowWall };
}
