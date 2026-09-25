import type { HireDef } from './balance';

/**
 * Oto Galeri at the west end of the high street, before Lale Mahallesi. Cars stand on
 * turntables; customers look them over and some come to the sales desk, where the
 * player (or a sales consultant) closes the deal for the gallery's margin. A sold car
 * drives out of the door and another is delivered to its turntable a little later.
 */
export const GALLERY_ORIGIN = { x: -84, z: 0.3 };

type P = [number, number];

export const GALLERY = {
  halfW: 13,
  halfD: 9,
  door: { x0: -2, x1: 2 },
  /** Turntables: two come with the building, the rest are unlocks. */
  podiums: [[-8.5, -5], [8.5, -5], [0, -5], [-8.5, 2.6], [8.5, 2.6]] as P[],
  /** Sales desk (centre); the seller stands behind it, buyers queue in front towards the door. */
  desk: [0, 2] as P,
  seller: [0, 0.9] as P,
  /** Where the player buys a car of their own, and the HR desk. */
  garage: [-10.2, 7] as P,
  hr: [10, 6.6] as P,
  /** Visitors arrive and leave along the pavement here (local z). */
  street: 12.5,
};

export const GALLERY_OPEN_COST = 15_000_000;
export const GALLERY_UNLOCKS = [
  { id: 'podium3', index: 2, cost: 800_000 },
  { id: 'podium4', index: 3, cost: 1_200_000 },
  { id: 'podium5', index: 4, cost: 1_600_000 },
];

export const GALLERY_HIRES: HireDef[] = [
  { id: 'salesperson', role: 'salesperson', costs: [60000] },
];

/** Seconds between shoppers, share who buy, seconds to close a deal, seconds until a new car is delivered. */
export const DEALS = { every: 7, buyChance: 0.45, close: 1.4, restock: 35, maxVisitors: 10 };
