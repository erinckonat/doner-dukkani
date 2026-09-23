import * as THREE from 'three';

export const C = {
  primary: '#C8412B',
  primaryDark: '#9E2F1E',
  cream: '#F4EAD8',
  gold: '#E3A64A',
  dark: '#2A1E18',
  wood: '#A0643A',
  woodLight: '#C98B55',
  woodDark: '#6E4128',
  lavash: '#EBCF96',
  meat: '#8C4A26',
  meatDark: '#6A3319',
  steel: '#A39B90',
  steelDark: '#7D756B',
  leaf: '#6F8F4E',
  leafDark: '#58763D',
  trash: '#E4D8C2',
  terracotta: '#C27552',
};

const mats = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, emissive?: string, emissiveIntensity = 0.6) {
  const key = `${color}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, flatShading: true, roughness: 0.85, metalness: 0,
      emissive: emissive ?? '#000000', emissiveIntensity: emissive ? emissiveIntensity : 0,
    });
    mats.set(key, m);
  }
  return m;
}

const geos = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key);
  if (!g) { g = make(); geos.set(key, g); }
  return g;
}

export function box(w: number, h: number, d: number, color: string, shadow = true) {
  const m = new THREE.Mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function cyl(rt: number, rb: number, h: number, seg: number, color: string, shadow = true) {
  const m = new THREE.Mesh(geo(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), mat(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** A wrapped döner lying on its side; origin at its bottom. */
export function makeDoner() {
  const g = new THREE.Group();
  const wrap = cyl(0.085, 0.085, 0.34, 7, C.lavash, false);
  wrap.rotation.z = Math.PI / 2;
  const band = cyl(0.092, 0.092, 0.15, 7, C.primary, false);
  band.rotation.z = Math.PI / 2;
  band.position.x = -0.07;
  const fill = cyl(0.07, 0.07, 0.02, 7, C.meat, false);
  fill.rotation.z = Math.PI / 2;
  fill.position.x = 0.171;
  const leaf = cyl(0.04, 0.04, 0.022, 5, C.leaf, false);
  leaf.rotation.z = Math.PI / 2;
  leaf.position.set(0.176, 0.02, 0.02);
  for (const m of [wrap, band, fill, leaf]) { m.position.y += 0.085; g.add(m); }
  return g;
}

export function makeTrash() {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(geo('trash', () => new THREE.IcosahedronGeometry(0.09, 0)), mat(C.trash));
  paper.position.y = 0.07;
  paper.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  const band = box(0.1, 0.03, 0.06, C.primary, false);
  band.position.set(0.02, 0.12, 0);
  band.rotation.y = Math.random() * 3;
  g.add(paper, band);
  return g;
}

export function makeTree() {
  const g = new THREE.Group();
  g.add(at(cyl(0.12, 0.16, 0.9, 6, C.woodDark), 0, 0.45, 0));
  g.add(at(cyl(0, 1.0, 1.5, 7, C.leaf), 0, 1.5, 0));
  g.add(at(cyl(0, 0.75, 1.2, 7, C.leafDark), 0, 2.25, 0));
  return g;
}

export function makePlant() {
  const g = new THREE.Group();
  g.add(at(cyl(0.3, 0.22, 0.5, 8, C.terracotta), 0, 0.25, 0));
  const bush = new THREE.Mesh(geo('bush', () => new THREE.IcosahedronGeometry(0.45, 0)), mat(C.leaf));
  bush.position.y = 0.85;
  bush.castShadow = true;
  g.add(bush);
  return g;
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas, ctx };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Small döner glyph for 2D canvases. */
export function drawDonerIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.5);
  ctx.fillStyle = C.lavash;
  roundRect(ctx, -s, -s * 0.38, s * 2, s * 0.76, s * 0.3);
  ctx.fill();
  ctx.fillStyle = C.primary;
  ctx.fillRect(-s * 0.7, -s * 0.4, s * 0.8, s * 0.8);
  ctx.fillStyle = C.meat;
  roundRect(ctx, s * 0.62, -s * 0.3, s * 0.38, s * 0.6, s * 0.15);
  ctx.fill();
  ctx.restore();
}

/** Dashed floor ring marking where to stand, with a small glyph in the middle. */
export function zoneDecal(kind: 'drop' | 'register') {
  const { tex } = canvasTexture(256, 256, (ctx) => {
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,250,240,0.55)';
    ctx.fill();
    ctx.setLineDash([26, 16]);
    ctx.lineWidth = 10;
    ctx.strokeStyle = C.primary;
    ctx.stroke();
    ctx.setLineDash([]);
    if (kind === 'drop') {
      drawDonerIcon(ctx, 128, 112, 44);
      ctx.strokeStyle = C.dark;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(100, 168); ctx.lineTo(128, 196); ctx.lineTo(156, 168);
      ctx.stroke();
    } else {
      ctx.fillStyle = C.dark;
      roundRect(ctx, 76, 104, 104, 72, 12);
      ctx.fill();
      ctx.fillStyle = C.gold;
      roundRect(ctx, 92, 72, 72, 40, 8);
      ctx.fill();
      ctx.fillStyle = C.cream;
      for (let i = 0; i < 3; i++) ctx.fillRect(90 + i * 28, 124, 20, 12);
    }
  });
  return floorDecal(tex, 1.3);
}

/** Floor decal: a flat plane textured with a canvas, lying on the ground. */
export function floorDecal(tex: THREE.Texture, size: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}
