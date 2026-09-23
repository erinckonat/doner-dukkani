import * as THREE from 'three';
import { BAL, SHOPS, type ShopId } from './config/balance';
import { buffAmount, BURGER_PLOT_ID, type Activity, type BuffId, type BusinessDef } from './config/city';
import { Sfx } from './core/Audio';
import { Flyer } from './core/Flyer';
import { Input } from './core/Input';
import type { Rect } from './core/Nav';
import { freshShop, loadSave, writeSave, type SaveData } from './core/Save';
import { easeOutQuart, Tweens } from './core/Tween';
import { dist2 } from './entities/Agent';
import { Ambient } from './entities/Ambient';
import { Player } from './entities/Player';
import { Shop, staffedIncome } from './Shop';
import type { DeskKind } from './stations/Props';
import { UnlockTile, type TileDef } from './stations/UnlockTile';
import { Confetti, FloatingText, makeArrow } from './systems/Effects';
import { ActivityPanel } from './ui/ActivityPanel';
import { fmtMoney, Hud } from './ui/Hud';
import { TR } from './ui/strings.tr';
import { SavePanel } from './ui/SavePanel';
import { UpgradePanel } from './ui/UpgradePanel';
import { buildCity, type BusinessPad, type CityRefs } from './world/City';
import { SHOP_ORIGIN_X, START_POS } from './world/layout';

const TUTORIAL_STEPS = TR.hints.length;
/** Half the width of a shop's plot along the street, for "which shop am I in". */
const PLOT_HALF = 17;

interface ActivityRun { biz: BusinessDef; act: Activity; t: number; pad: BusinessPad }

/**
 * The high street: the player, the shops they own (each running on its own), the
 * businesses across the road, and everything shared — money, HUD, camera, save.
 */
export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(24, 1, 0.5, 220);
  flyer = new Flyer(this.scene);
  tweens = new Tweens();
  sfx = new Sfx();
  input: Input;
  hud: Hud;
  panel: UpgradePanel;
  savePanel: SavePanel;
  activityPanel: ActivityPanel;
  data: SaveData;
  player: Player;
  shops: Shop[] = [];
  floats: FloatingText;
  cashMultiplierUntil = 0;
  time = 0;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private city: CityRefs;
  private ambient: Ambient;
  private sun: THREE.DirectionalLight;
  private rects: Rect[] = [];
  private rectsKey = '';
  private plotTile: UnlockTile | null = null;
  private confetti: Confetti;
  private arrow: ReturnType<typeof makeArrow>;
  private saveT = 0;
  private buffT = 0;
  private last = 0;
  private deskInside: DeskKind | null = null;
  private padInside: BusinessPad | null = null;
  private padHold = 0;
  private activity: ActivityRun | null = null;
  private active: Shop | null = null;
  private camTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, initialSave?: SaveData) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color('#E8D9BF');
    this.scene.fog = new THREE.Fog('#E8D9BF', 50, 95);
    this.scene.add(new THREE.HemisphereLight('#FFF4E0', '#B89A7A', 1.25));
    // The sun follows the player so shadows stay sharp across the whole street.
    const sun = (this.sun = new THREE.DirectionalLight('#FFE8C8', 1.9));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 24, bottom: -24, near: 1, far: 70 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.data = initialSave ?? loadSave();
    delete this.data.shop; // shops are side by side now; nothing to travel between
    this.sfx.enabled = this.data.sound;

    this.city = buildCity(this.scene);
    this.ambient = new Ambient(this.scene);

    this.player = new Player(this.flyer, () => this.playerCap);
    this.player.pos.set(START_POS[0], 0, START_POS[1]);
    this.player.ch.setYaw(Math.PI);
    this.scene.add(this.player.ch.root);

    this.input = new Input(canvas, document.getElementById('joy')!, document.getElementById('joy-knob')!);
    this.input.onFirstGesture = () => this.sfx.unlock();
    this.hud = new Hud(this.data.sound, () => {
      this.data.sound = this.sfx.enabled = !this.sfx.enabled;
      writeSave(this.data);
      return this.data.sound;
    });
    this.panel = new UpgradePanel(this);
    this.savePanel = new SavePanel(this);
    this.activityPanel = new ActivityPanel(this);
    this.confetti = new Confetti(this.scene);
    this.floats = new FloatingText(this.scene, this.tweens, this.reduced);
    this.arrow = makeArrow();
    this.scene.add(this.arrow.group);

    this.shops.push(new Shop(this, 'doner', SHOP_ORIGIN_X.doner));
    if (this.data.burger) this.openBurgerShop(false);
    else this.refreshPlotTile();

    this.grantOffline();

    addEventListener('resize', this.resize);
    this.resize();
    const persist = () => writeSave(this.data);
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  }

  // ---------- player stats ----------

  get money() { return this.data.money; }

  private get doner() { return this.shops[0]; }

  get playerSpeed() {
    return this.doner.upgradeValue('pSpeed', this.doner.lvl('pSpeed')) * (1 + buffAmount(this.data.buffs, 'speed'));
  }

  get playerCap() {
    return this.doner.upgradeValue('pCap', this.doner.lvl('pCap')) + buffAmount(this.data.buffs, 'carry');
  }

  addMoney(v: number) { this.data.money += v; }

  incomePerSecond() { return this.shops.reduce((s, x) => s + x.incomePerSecond(), 0); }

  /** The shop whose plot the player is standing in (or nearest to). */
  activeShop(): Shop {
    const x = this.player.pos.x;
    return this.shops.reduce((a, b) => (Math.abs(b.ox - x) < Math.abs(a.ox - x) ? b : a));
  }

  private inPlot(s: Shop) { return Math.abs(this.player.pos.x - s.ox) < PLOT_HALF; }

  // ---------- shared helpers for shops ----------

  /** Pop something into existence with confetti and a fanfare. */
  celebrate(obj: THREE.Object3D, at: THREE.Vector3) {
    if (!this.reduced) {
      const base = obj.scale.clone();
      this.tweens.add(0.45, (k) => obj.scale.copy(base).multiplyScalar(Math.max(0.01, easeOutQuart(k))));
      this.confetti.burst(at);
    }
    this.sfx.play('unlock', 1, 0);
  }

  /**
   * Standing on a price tile drains money into it. Returns true when paid off.
   * Crossing a 1.9 m tile at walking speed takes ~0.4 s; only a deliberate stop pays.
   */
  payTile(tile: UnlockTile, inside: boolean, dt: number, paid: Record<string, number>) {
    if (!inside) { tile.hold = 0; return false; }
    tile.hold += dt;
    if (tile.hold < 0.5 || this.data.money < 1) return false;
    const rate = Math.max(tile.def.cost / 1.3, 40);
    const amt = Math.min(this.data.money, tile.remaining, rate * dt);
    this.data.money -= amt;
    tile.paid += amt;
    paid[tile.def.id] = tile.paid;
    tile.draw();
    this.sfx.play('tick', 1 + (tile.paid / tile.def.cost) * 1.5, 70);
    return tile.remaining <= 0.001;
  }

  onShopProgress(s: Shop) {
    if (this.active === s) this.hud.setProgress(s.ss.unlocked.length, s.def.unlocks.length);
    if (s.id === 'doner') this.refreshPlotTile();
  }

  // ---------- the burger plot next door ----------

  /** Once the döner shop is complete, the empty plot next door goes on sale. */
  private refreshPlotTile() {
    if (this.data.burger || this.plotTile) return;
    const d = this.doner;
    if (d.ss.unlocked.length < d.def.unlocks.length) return;
    const def: TileDef = {
      id: BURGER_PLOT_ID, cost: SHOPS.burger.openCost,
      x: SHOP_ORIGIN_X.burger, z: 11.6, label: TR.city.plotLabel,
    };
    this.plotTile = new UnlockTile(def, this.data.paid[BURGER_PLOT_ID] ?? 0, this.scene);
  }

  private openBurgerShop(animate: boolean) {
    this.data.burger ??= freshShop();
    this.city.plot.removeFromParent();
    const shop = new Shop(this, 'burger', SHOP_ORIGIN_X.burger);
    this.shops.push(shop);
    if (animate) {
      this.celebrate(shop.root, new THREE.Vector3(SHOP_ORIGIN_X.burger, 0, 6));
      this.hud.toast(TR.gate.opened(TR.shopName.burger));
    }
  }

  private updatePlotTile(dt: number) {
    const tile = this.plotTile;
    if (!tile) return;
    tile.update(this.reduced ? 0 : this.time);
    if (!this.payTile(tile, dist2(this.player.pos, tile.pos) < 0.95 * 0.95, dt, this.data.paid)) return;
    delete this.data.paid[BURGER_PLOT_ID];
    tile.dispose();
    this.plotTile = null;
    this.openBurgerShop(true);
    writeSave(this.data);
  }

  // ---------- businesses across the street ----------

  startActivity(biz: BusinessDef, act: Activity) {
    const pad = this.city.pads.find((p) => p.biz === biz);
    if (this.activity || !pad || this.data.money < act.price) return;
    this.data.money -= act.price;
    this.activity = { biz, act, t: 0, pad };
    this.activityPanel.close();
    this.player.ch.root.visible = false;
    this.sfx.play('register', 1, 0);
  }

  private updateActivity(dt: number) {
    const run = this.activity;
    if (!run) return;
    run.t += dt;
    const left = Math.ceil(run.act.secs - run.t);
    const name = TR.city.activity[run.act.id];
    this.hud.setHint(TR.city.busy(name, Math.max(0, left)));
    if (run.t < run.act.secs) return;
    // Out again, refreshed: the boost runs from now, the stronger of any overlap wins.
    this.activity = null;
    this.player.ch.root.visible = true;
    this.player.pos.set(run.pad.pos.x, 0, run.pad.pos.z - 1);
    const buffs = (this.data.buffs ??= {});
    const cur = buffs[run.act.buff];
    const until = Date.now() + run.act.minutes * 60_000;
    const amount = Math.max(run.act.amount, cur && cur.until > Date.now() ? cur.amount : 0);
    buffs[run.act.buff] = { until: Math.max(until, cur?.until ?? 0), amount };
    this.hud.setHint(null);
    this.hud.toast(TR.city.done(name));
    this.sfx.play('unlock', 1, 0);
    writeSave(this.data);
  }

  private updatePads(dt: number) {
    if (this.activity) return;
    const pad = this.city.pads.find((p) => dist2(this.player.pos, p.pos) < 0.9 * 0.9) ?? null;
    if (pad !== this.padInside) {
      this.padInside = pad;
      this.padHold = 0;
      if (!pad) this.activityPanel.close();
    }
    if (!pad || this.activityPanel.isOpen) return;
    this.padHold += dt;
    if (this.padHold < 0.4) return;
    this.panel.close();
    this.savePanel.close();
    this.activityPanel.open(pad.biz);
  }

  private updateBuffChips(dt: number) {
    this.buffT -= dt;
    if (this.buffT > 0) return;
    this.buffT = 0.5;
    const now = Date.now();
    const chips: { label: string; secs: number }[] = [];
    for (const [id, b] of Object.entries(this.data.buffs ?? {}) as [BuffId, { until: number; amount: number }][]) {
      if (b.until <= now) continue;
      const amt = id === 'carry' ? `+${b.amount}` : `+%${Math.round(b.amount * 100)}`;
      chips.push({ label: `${TR.city.buffChip[id]} ${amt}`, secs: (b.until - now) / 1000 });
    }
    this.hud.setBuffs(chips);
  }

  // ---------- misc systems ----------

  /** Staffed shops keep earning (at a reduced rate) while the game is closed. */
  private grantOffline() {
    if (!this.data.t) return;
    const secs = Math.min((Date.now() - this.data.t) / 1000, BAL.offlineCapSec);
    const rate = (['doner', 'burger'] as ShopId[]).reduce((s, id) => s + staffedIncome(this.data, id), 0);
    const earn = Math.floor(secs * rate * BAL.offlineRate);
    if (earn < 1) return;
    this.data.money += earn;
    setTimeout(() => this.hud.toast(TR.offline(fmtMoney(earn))), 600);
  }

  private tutorialTarget(step: number): THREE.Vector3 | null {
    const s = this.doner;
    const k = s.counters[0];
    switch (step) {
      case 0: return s.producers[0].zone;
      case 1: return k.dropZone;
      case 2: return k.cashierZone;
      case 3: return s.tiles.find((t) => t.def.id === 'table1')?.pos ?? null;
      default: return null;
    }
  }

  private tutorialDone(step: number) {
    const s = this.doner;
    const k = s.counters[0];
    switch (step) {
      case 0: return this.player.stack.kind === s.def.main || k.stockCount > 0;
      case 1: return k.stockCount > 0 || s.served > 0;
      case 2: return s.served > 0;
      case 3: return s.ss.unlocked.includes('table1');
      default: return true;
    }
  }

  private updateTutorial() {
    const a = this.arrow;
    while (this.data.tut < TUTORIAL_STEPS && this.tutorialDone(this.data.tut)) this.data.tut++;
    const step = this.data.tut;
    const local = step < TUTORIAL_STEPS ? this.tutorialTarget(step) : null;
    if (!this.activity) this.hud.setHint(local ? TR.hints[step] : null);
    a.group.visible = !!local;
    if (!local) return;
    const target = this.doner.toWorld(local);
    const t = this.reduced ? 0 : this.time;
    a.group.position.set(target.x, 0, target.z);
    a.cone.position.y = 1.7 + Math.sin(t * 5) * 0.15;
    a.cone.rotation.y = t;
    a.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
  }

  private updateDesks() {
    const s = this.active!;
    const kind = this.inPlot(s) ? s.deskAt(new THREE.Vector3(this.player.pos.x - s.ox, 0, this.player.pos.z)) : null;
    if (kind && kind !== this.deskInside) {
      this.savePanel.close();
      this.activityPanel.close();
      this.panel.open(kind, s);
    }
    if (!kind && this.deskInside) this.panel.close();
    this.deskInside = kind;
  }

  /** Player collision: city buildings plus every shop's current obstacles. */
  private updateRects() {
    const key = this.shops.map((s) => s.rectsVersion).join();
    if (key === this.rectsKey) return;
    this.rectsKey = key;
    this.rects = [...this.city.rects, ...this.shops.flatMap((s) => s.worldRects())];
  }

  private updateAmbience(dt: number) {
    const s = this.active!;
    const p = this.player.pos;
    const near = Math.min(...s.producers.map((m) => Math.sqrt(dist2(p, s.toWorld(m.zone)))));
    const kitchen = Math.max(0, Math.min(1, 1 - (near - 1) / 10));
    const crowd = this.inPlot(s) ? s.crowd : Math.min(4, s.crowd);
    this.sfx.update(dt, crowd, kitchen, s.producers.length);
  }

  private resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private updateCamera(dt: number, snap = false) {
    const a = this.camera.aspect;
    const f = a < 0.75 ? 1.55 : a < 1.2 ? 1.25 : 1;
    const p = this.player.pos;
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.camTarget.x += (p.x - this.camTarget.x) * k;
    this.camTarget.z += (p.z - this.camTarget.z) * k;
    // Narrow FOV from further back keeps verticals upright, like the genre's near-orthographic look.
    this.camera.position.set(this.camTarget.x, 23 * f, this.camTarget.z + 16.5 * f);
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 0.6);
    this.sun.position.set(this.camTarget.x + 8, 20, this.camTarget.z + 10);
    this.sun.target.position.set(this.camTarget.x - 2, 0, this.camTarget.z + 2);
  }

  private update(dt: number) {
    this.time += dt;
    this.updateRects();
    const move = this.activity ? { x: 0, z: 0 } : this.input.move;
    this.player.update(dt, move, this.playerSpeed, this.rects);

    const active = this.activeShop();
    if (active !== this.active) {
      this.active = active;
      this.hud.setProgress(active.ss.unlocked.length, active.def.unlocks.length);
      if (this.panel.isOpen) this.panel.close();
    }
    const p = this.player.pos;
    for (const s of this.shops) s.update(dt, p, this.inPlot(s) && !this.activity);
    if (this.inPlot(active) && !this.activity) {
      active.interact(this.player, new THREE.Vector3(p.x - active.ox, 0, p.z));
    }
    this.updateDesks();
    this.updatePlotTile(dt);
    this.updatePads(dt);
    this.updateActivity(dt);
    this.ambient.update(dt);
    for (const s of this.city.spinners) s.rotation.y += dt * 2;
    this.flyer.update(dt);
    this.tweens.update(dt);
    this.confetti.update(dt);
    this.updateTutorial();
    this.updateCamera(dt);
    this.hud.setMoney(this.data.money);
    this.updateBuffChips(dt);
    this.panel.update(dt);
    this.activityPanel.update(dt);
    this.updateAmbience(dt);
    this.saveT += dt;
    if (this.saveT > 5) {
      this.saveT = 0;
      writeSave(this.data);
    }
  }

  start() {
    this.updateCamera(0, true);
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

