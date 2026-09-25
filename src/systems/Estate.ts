import * as THREE from 'three';
import { BAL } from '../config/balance';
import { ESTATE_MANAGER_COST, PROPERTIES, RENOVATE, type PropertyDef } from '../config/estate';
import type { SaveData } from '../core/Save';
import type { Game } from '../Game';
import { fmtMoney } from '../ui/Hud';
import { TR } from '../ui/strings.tr';
import { at, box, C, canvasTexture, cyl, roundRect } from '../world/Assets';
import { CITY } from '../world/layout';

export interface PropertyState {
  /** Houses and flats: tenants in. Shops trade as soon as they're bought. */
  rented: boolean;
  level: number;
  /** Rent waiting at the door. */
  due: number;
}

export interface EstateState {
  props: Record<string, PropertyState>;
  manager?: boolean;
}

export const freshEstate = (): EstateState => ({ props: {} });

/** TL/second a property brings in right now (0 if not owned or standing empty). */
export function propertyRate(def: PropertyDef, st: PropertyState | undefined) {
  if (!st || (def.kind !== 'shop' && !st.rented)) return 0;
  return def.rent * (1 + RENOVATE.step * st.level);
}

export function estateRate(data: SaveData) {
  const props = data.estate?.props ?? {};
  return PROPERTIES.reduce((s, d) => s + propertyRate(d, props[d.id]), 0);
}

/** A board on posts in front of each property: for sale, to let, or yours. */
interface Board { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string }

/**
 * Ownership of the street's buildings: buying, letting, renovating, and the rent that
 * piles up at each door until it's collected (or an estate manager banks it).
 */
export class Estate {
  private boards = new Map<string, Board>();
  private managerT = 0;
  private boardT = 0;

  constructor(private g: Game, scene: THREE.Scene) {
    for (const d of PROPERTIES) this.boards.set(d.id, this.makeBoard(scene, d));
    this.drawBoards();
  }

  get s() { return (this.g.data.estate ??= { props: {} }); }
  st(id: string) { return this.s.props[id]; }
  owns(id: string) { return !!this.s.props[id]; }
  get hasManager() { return !!this.s.manager; }

  rate(d: PropertyDef) { return propertyRate(d, this.st(d.id)); }
  renovateCost(d: PropertyDef) { return Math.round((d.price * RENOVATE.cost * ((this.st(d.id)?.level ?? 0) + 1)) / 10000) * 10000; }

  buy(d: PropertyDef) {
    if (this.owns(d.id) || this.g.data.money < d.price) return;
    this.g.data.money -= d.price;
    this.s.props[d.id] = { rented: false, level: 0, due: 0 };
    this.g.sfx.play('unlock', 1, 0);
    this.g.celebrateAtPlayer();
    this.g.hud.toast(d.kind === 'shop' ? TR.estate.boughtShop(d.name) : TR.estate.bought(d.name));
    this.after();
  }

  rentOut(d: PropertyDef) {
    const st = this.st(d.id);
    if (!st || st.rented || d.kind === 'shop') return;
    st.rented = true;
    this.g.sfx.play('register', 1, 0);
    this.g.hud.toast(TR.estate.rented(d.name, fmtMoney(this.rate(d))));
    this.after();
  }

  renovate(d: PropertyDef) {
    const st = this.st(d.id);
    const cost = this.renovateCost(d);
    if (!st || st.level >= RENOVATE.max || this.g.data.money < cost) return;
    this.g.data.money -= cost;
    st.level++;
    this.g.sfx.play('unlock', 1, 0);
    this.g.hud.toast(TR.estate.renovated(d.name, st.level));
    this.after();
  }

  /** Empty a property's rent box into the account. */
  collect(d: PropertyDef) {
    const st = this.st(d.id);
    if (!st || st.due < 1) return 0;
    const amount = Math.floor(st.due);
    st.due -= amount;
    this.g.sale(amount, false);
    const p = this.g.player.pos;
    this.g.floats.spawn(new THREE.Vector3(p.x, 2.4, p.z), `+${fmtMoney(amount)}`);
    this.g.sfx.play('register', 1, 0);
    return amount;
  }

  hireManager() {
    if (this.s.manager || this.g.data.money < ESTATE_MANAGER_COST) return;
    this.g.data.money -= ESTATE_MANAGER_COST;
    this.s.manager = true;
    this.g.sfx.play('unlock', 1, 0);
    this.g.hud.toast(TR.estate.managerHired);
    this.after();
  }

  private after() {
    this.drawBoards();
    this.g.activityPanel.render();
    this.g.save();
  }

  get totalRate() { return estateRate(this.g.data); }
  get totalDue() { return Object.values(this.s.props).reduce((n, p) => n + p.due, 0); }

  /** Time away: rent accrues at the reduced offline rate (straight to the account with a manager). */
  offline(secs: number) {
    let banked = 0;
    for (const d of PROPERTIES) {
      const st = this.st(d.id);
      const amount = propertyRate(d, st) * secs * BAL.offlineRate;
      if (!st || amount <= 0) continue;
      if (this.hasManager) banked += amount;
      else st.due += amount;
    }
    if (banked >= 1) this.g.sale(Math.floor(banked), false);
    return banked;
  }

  update(dt: number) {
    const mult = this.g.bonusMult();
    for (const d of PROPERTIES) {
      const st = this.st(d.id);
      const r = propertyRate(d, st);
      if (st && r) st.due += r * dt * mult;
    }
    if (this.hasManager) {
      this.managerT -= dt;
      if (this.managerT <= 0) {
        this.managerT = 3;
        let total = 0;
        for (const st of Object.values(this.s.props)) {
          const a = Math.floor(st.due);
          st.due -= a;
          total += a;
        }
        if (total) this.g.sale(total, false);
      }
    }
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = 0.5;
      this.drawBoards();
    }
  }

  // ---------- boards ----------

  private makeBoard(scene: THREE.Scene, d: PropertyDef): Board {
    const { tex, ctx } = canvasTexture(384, 192, () => {});
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    panel.position.y = 1.35;
    g.add(panel, at(box(1.6, 0.85, 0.06, C.woodDark), 0, 1.35, -0.04));
    for (const x of [-0.6, 0.6]) g.add(at(cyl(0.05, 0.05, 1.0, 6, C.woodDark), x, 0.5, -0.05));
    // On the left of the door, clear of awnings, café tables and the barber's pole.
    g.position.set(d.x - d.w / 2 + 1.0, 0, CITY.northFront + 0.3);
    scene.add(g);
    return { ctx, tex, key: '' };
  }

  private drawBoards() {
    for (const d of PROPERTIES) {
      const b = this.boards.get(d.id)!;
      const st = this.st(d.id);
      const [title, line, colour] = !st
        ? [TR.estate.forSale, fmtMoney(d.price), '#2F5D8C']
        : d.kind !== 'shop' && !st.rented
          ? [TR.estate.toLet, TR.estate.empty, '#B5462B']
          : [TR.estate.yours, st.due >= 1 ? TR.estate.dueShort(fmtMoney(st.due)) : TR.estate.perSec(fmtMoney(this.rate(d))), '#3E6B5A'];
      const key = `${title}|${line}`;
      if (key === b.key) continue;
      b.key = key;
      const ctx = b.ctx;
      ctx.clearRect(0, 0, 384, 192);
      ctx.fillStyle = C.cream;
      roundRect(ctx, 6, 6, 372, 180, 22);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = colour;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colour;
      ctx.font = '800 60px "Baloo 2", sans-serif';
      ctx.fillText(title, 192, 72);
      ctx.fillStyle = C.dark;
      ctx.font = '700 40px "Baloo 2", sans-serif';
      ctx.fillText(line, 192, 138);
      b.tex.needsUpdate = true;
    }
  }
}
