import * as THREE from 'three';
import { BAL } from '../config/balance';
import type { GroceryKind } from '../config/market';
import type { Checkout, Market, Segment } from '../Market';
import { gridLayout, ItemStack } from '../systems/ItemStack';
import { box } from '../world/Assets';
import { Agent } from './Agent';
import { LOOKS, pick } from './Character';
import { makeAngryEmote } from './Emote';

/** One stop on the way round the store: a corner of the maze, or a shelf to pick from. */
export type Stop = { to: THREE.Vector3; seg?: Segment; n?: number };

/** Seconds per item taken off a shelf, and how long to wait at an empty one. */
const PICK_EVERY = 0.35;
const EMPTY_WAIT = 3;

/**
 * A supermarket shopper: walks the whole winding route through the aisles with a
 * basket, stops at the shelves on their list, then queues at a checkout and pays.
 */
export class Shopper extends Agent {
  state: 'route' | 'picking' | 'queue' | 'leaving' = 'route';
  basket: ItemStack;
  bought: GroceryKind[] = [];
  checkout: Checkout | null = null;
  waitT = 0;
  dead = false;
  /** Asked for something the shelf didn't have. */
  missed = 0;
  private stops: Stop[];
  private current: Stop | null = null;
  private timer = 0;
  private emote = makeAngryEmote(2.3);

  constructor(private m: Market, stops: Stop[], from: THREE.Vector3) {
    super({ shirt: pick(LOOKS.shirts), pants: pick(LOOKS.pants), skin: pick(LOOKS.skins), hair: pick(LOOKS.hair) });
    this.speed = BAL.customerSpeed * (0.9 + Math.random() * 0.25);
    this.stops = stops;
    // A wire basket in hand; picked items sit in it.
    const basket = new THREE.Group();
    basket.add(box(0.46, 0.04, 0.3, '#B8433A', false));
    for (const [x, z, w, d] of [[0, 0.15, 0.46, 0.03], [0, -0.15, 0.46, 0.03], [0.22, 0, 0.03, 0.3], [-0.22, 0, 0.03, 0.3]]) {
      const side = box(w, 0.14, d, '#C8412B', false);
      side.position.set(x, 0.08, z);
      basket.add(side);
    }
    basket.position.y = -0.05;
    this.ch.hand.add(basket);
    this.basket = new ItemStack(basket, m.flyer, () => 99, gridLayout(2, 2, 0.2, 0.14), true);
    this.emote.visible = false;
    this.ch.root.add(this.emote);
    this.pos.copy(from);
    this.next();
  }

  private next() {
    this.current = this.stops.shift() ?? null;
    if (!this.current) {
      this.m.toCheckout(this);
      return;
    }
    this.state = 'route';
    this.goTo(this.m.nav, this.current.to);
  }

  update(dt: number) {
    this.step(dt);
    this.ch.carrying = true;
    switch (this.state) {
      case 'route':
        if (!this.arrived) break;
        if (this.current?.seg) {
          this.state = 'picking';
          this.timer = PICK_EVERY;
          this.waitT = 0;
        } else this.next();
        break;
      case 'picking': {
        const stop = this.current!;
        const seg = stop.seg!;
        this.ch.face(0, 1, dt);
        this.timer -= dt;
        if (this.timer > 0) break;
        this.timer = PICK_EVERY;
        if (!stop.n) { this.next(); break; }
        if (seg.stack.count) {
          this.m.takeFromShelf(seg, this);
          stop.n--;
          this.waitT = 0;
          break;
        }
        this.waitT += PICK_EVERY;
        if (this.waitT < EMPTY_WAIT) break;
        // Nothing on the shelf: note it and move on without.
        this.missed++;
        this.m.shelfEmpty(this, seg);
        this.next();
        break;
      }
      case 'queue': {
        const k = this.checkout!;
        if (this.arrived) {
          this.ch.face(0, 1, dt);
          this.waitT += dt;
        }
        this.emote.visible = this.waitT > BAL.angryAfter;
        const beingServed = k.queue[0] === this && k.belt.count > 0;
        if (this.waitT > BAL.giveUpAfter && !beingServed) this.m.gaveUp(this);
        break;
      }
      case 'leaving':
        if (!this.arrived) break;
        if (this.stops.length) {
          this.goTo(this.m.nav, this.stops.shift()!.to);
          break;
        }
        this.basket.clear();
        this.ch.root.removeFromParent();
        this.dead = true;
        break;
    }
  }

  queueAt(k: Checkout, spot: THREE.Vector3) {
    this.checkout = k;
    this.state = 'queue';
    this.waitT = 0;
    this.goTo(this.m.nav, spot);
  }

  /** Out through the front and back down the side street. */
  leave(route: THREE.Vector3[], angry = false) {
    this.state = 'leaving';
    this.checkout = null;
    this.emote.visible = angry;
    this.stops = route.slice(1).map((to) => ({ to }));
    this.goTo(this.m.nav, route[0]);
  }
}
