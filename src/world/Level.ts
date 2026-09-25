import * as THREE from 'three';
import { Door } from '../stations/Door';
import type { Rect } from '../core/Nav';
import type { ShopId, ShopTheme } from '../config/balance';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, drawProductIcon, makePlant, roundRect } from './Assets';
import { CITY, DOOR, DRIVE_ROAD, ROOM } from './layout';

export interface LevelRefs {
  rects: Rect[];
  windowWall: THREE.Object3D;
  /** Sliding glass doors in the front entrance. */
  door: Door;
}

const WALL = 0.3;

export function plane(w: number, d: number, color: string | THREE.Texture, y: number) {
  const material = typeof color === 'string'
    ? new THREE.MeshStandardMaterial({ color, roughness: 1 })
    : new THREE.MeshStandardMaterial({ map: color, roughness: 1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function wall(scene: THREE.Object3D, rects: Rect[], r: Rect, h: number, color: string) {
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

/** One shop's building, in its local frame (the city is built separately). */
export function buildShopBuilding(scene: THREE.Object3D, shop: ShopId, theme: ShopTheme): LevelRefs {
  const rects: Rect[] = [];
  const { minX, maxX, minZ, maxZ } = ROOM;

  // Drive-thru road along the left wall, from behind the shop down to the high street.
  const { x0, x1 } = DRIVE_ROAD;
  const roadX = (x0 + x1) / 2;
  const roadStart = -60;
  const roadEnd = CITY.road.z0;
  const roadLen = roadEnd - roadStart;
  scene.add(at(plane(x1 - x0, roadLen, '#7A6C60', 0), roadX, -0.012, (roadStart + roadEnd) / 2));
  for (const x of [x0 + 0.12, x1 - 0.12]) scene.add(at(plane(0.1, roadLen, '#EFE4CF', 0), x, -0.009, (roadStart + roadEnd) / 2));
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
    ctx.fillStyle = theme.floorA;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = theme.floorB;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);
  }).tex;
  floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
  floor.repeat.set((maxX - minX) / 2, (maxZ - minZ) / 2);
  scene.add(at(plane(maxX - minX, maxZ - minZ, floor, 0), 0, 0, 0));

  // Kitchen zone behind the counter.
  scene.add(at(plane(10, 6.5, theme.kitchen, 0.004), -5, 0.004, -5.75));
  scene.add(at(plane(10, 0.08, theme.stripe, 0.006), -5, 0.006, -2.5));

  // Walls: tall at the back, low at the sides, knee-high in front so the camera sees in.
  const back = wall(scene, rects, { x0: minX - WALL, x1: maxX + WALL, z0: minZ - WALL, z1: minZ }, 2.6, '#EAD7BD');
  back.castShadow = false;
  const stripe = box(maxX - minX, 0.14, 0.04, theme.stripe, false);
  stripe.position.set(0, 1.1, minZ + 0.02);
  scene.add(stripe);
  wall(scene, rects, { x0: minX - WALL, x1: minX, z0: minZ, z1: 2 }, 1.3, theme.wall);
  wall(scene, rects, { x0: minX - WALL, x1: minX, z0: 4, z1: maxZ }, 1.3, theme.wall);
  wall(scene, rects, { x0: maxX, x1: maxX + WALL, z0: minZ, z1: maxZ }, 1.3, theme.wall);
  wall(scene, rects, { x0: minX - WALL, x1: DOOR.x0, z0: maxZ, z1: maxZ + WALL }, 0.5, theme.wall);
  wall(scene, rects, { x0: DOOR.x1, x1: maxX + WALL, z0: maxZ, z1: maxZ + WALL }, 0.5, theme.wall);

  // Window gap on the left wall is always solid: wall until unlocked, counter after.
  const windowWall = box(WALL, 1.3, 2, theme.wall);
  windowWall.position.set(minX - WALL / 2, 0.65, 3);
  scene.add(windowWall);
  rects.push({ x0: -10.4, x1: -9.6, z0: 2, z1: 4 });

  // Automatic glass doors in the entrance, framed in the shop's colour.
  const door = new Door(scene, { x: (DOOR.x0 + DOOR.x1) / 2, z: maxZ + WALL / 2, width: DOOR.x1 - DOOR.x0, height: 1.5, style: 'slide', color: theme.stripe });

  // Door mat.
  scene.add(at(plane(3, 1.2, theme.stripe, 0.006), 0, 0.006, maxZ - 0.7));

  // Shop sign on the back wall.
  const sign = canvasTexture(1024, 192, (ctx) => {
    const icon = shop === 'doner' ? 'doner' : 'burger';
    ctx.fillStyle = C.cream;
    roundRect(ctx, 8, 8, 1008, 176, 40);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = theme.stripe;
    ctx.stroke();
    drawProductIcon(ctx, icon, 120, 96, 56);
    drawProductIcon(ctx, icon, 904, 96, 56);
    ctx.fillStyle = shop === 'doner' ? C.primary : '#8A4A12';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Shrink the name until it clears the icons at both ends.
    const name = TR.shopName[shop].toLocaleUpperCase('tr-TR');
    let size = 108;
    do ctx.font = `800 ${size}px "Baloo 2", sans-serif`;
    while (ctx.measureText(name).width > 680 && (size -= 4) > 48);
    ctx.fillText(name, 512, 104);
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
  return { rects, windowWall, door };
}
