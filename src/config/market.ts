/**
 * The supermarket on the side street. Retail: goods arrive by truck at the stockroom,
 * get carried to the shelves, and shoppers walk a winding route through the aisles,
 * picking what's on the shelves, then pay at a checkout.
 *
 * Retail prices, Sept 2026: 200 g bread 17.50 TL (bakers' federation, 1 Apr 2026);
 * 1 L milk 69.50 TL and 30 eggs 169.90 TL (market survey, 18 Sept 2026); Barilla
 * pasta 42.50 TL; 5 L sunflower oil 449 TL and Persil 389 TL (BİM, 24 Sept 2026).
 * Wholesale is 78% of retail (a 22% gross margin, typical for grocery).
 */

import type { HireDef } from './balance';

export type GroceryKind = 'bread' | 'milk' | 'eggs' | 'pasta' | 'oil' | 'detergent';

export interface GroceryDef { kind: GroceryKind; price: number; color: string; label: string }

export const GROCERIES: Record<GroceryKind, GroceryDef> = {
  bread: { kind: 'bread', price: 17.5, color: '#D9A35B', label: '#8A5A2B' },
  milk: { kind: 'milk', price: 69.5, color: '#F4F1EA', label: '#2F5D8C' },
  eggs: { kind: 'eggs', price: 169.9, color: '#E8D6B0', label: '#C27552' },
  pasta: { kind: 'pasta', price: 42.5, color: '#2F5D8C', label: '#E3A64A' },
  oil: { kind: 'oil', price: 449, color: '#E3C84A', label: '#3E6B5A' },
  detergent: { kind: 'detergent', price: 389, color: '#C8412B', label: '#F4F1EA' },
};

export const WHOLESALE_SHARE = 0.78;
export const wholesaleOf = (k: GroceryKind) => Math.round(GROCERIES[k].price * WHOLESALE_SHARE * 100) / 100;

/** Where the market sits: its local origin in world coordinates (a street north off the high street). */
export const MARKET_ORIGIN = { x: 100, z: -30 };
/** The side street from the high street up to the market's front plaza (world x range). */
export const SIDE_STREET = { x0: 85, x1: 91, z0: -14, z1: 15 };

/**
 * Local layout (metres). The sales floor spans x -16..16, z -14..14, front wall at z 14.
 * Shoppers come in at the front-left, walk down a corridor to the back, then snake
 * forward aisle by aisle — each shelf row leaves a gap at alternating ends — to the
 * checkouts at the front-right.
 */
export const MARKET = {
  halfW: 16,
  halfD: 14,
  entrance: { x0: -15, x1: -12 },
  exit: { x0: 0, x1: 12 },
  /** Partition that makes the entry corridor, from the front down to this z. */
  partitionX: -12,
  partitionEnd: -9,
  /** Shelf rows: z, x-extent. Built from the back (row 0) to the front (row 3). */
  rows: [
    { z: -8, x0: -12, x1: 11 },
    { z: -4, x0: -8, x1: 16 },
    { z: 0, x0: -12, x1: 11 },
    { z: 4, x0: -8, x1: 16 },
  ],
  rowDepth: 1.0,
  shelfHeight: 1.3,
  /** Aisle centre lines, back to front. */
  aisles: [-11, -6, -2, 2, 6],
  /** Checkout counters (x of each), lanes to their left, cashiers to their right. */
  checkouts: [2, 6, 10],
  checkoutZ: 10.2,
  /** Stockroom behind the back wall on the right, with pallets along its back. */
  stock: { x0: 8, x1: 16, z0: -20, z1: -14, doorX0: 12, doorX1: 15, truckDoorZ0: -19.2, truckDoorZ1: -16.8 },
  palletZ: -19.1,
  palletXs: [9.2, 10.4, 11.6, 12.8, 14.0, 15.2],
  /** The staff desk for hiring, just inside the exit. */
  desk: [14, 11] as [number, number],
};

/** Which product each shelf segment holds: [row][segment]. */
export const SHELF_PRODUCTS: GroceryKind[][] = [
  ['milk', 'pasta', 'detergent'],
  ['bread', 'eggs', 'oil'],
  ['pasta', 'oil', 'detergent'],
  ['bread', 'milk', 'eggs'],
];
export const SEGMENTS_PER_ROW = 3;
export const SHELF_CAP = 16;
export const PALLET_CAP = 30;
/** Pallet order in the stockroom (one per product, left to right). */
export const PALLET_KINDS: GroceryKind[] = ['bread', 'milk', 'eggs', 'pasta', 'oil', 'detergent'];

/** Rows 2 and 3 (the front two) come with the building; the rest are unlocks. */
export const STARTING_ROWS = [2, 3];

export interface MarketUnlock { id: string; kind: 'row' | 'checkout' | 'desk'; index: number; cost: number; x: number; z: number }

/**
 * Fit-out costs are estimates: a double-sided gondola run ~90–110 k TL, a checkout
 * lane ~45 k TL, the staff desk 25 k TL. Buying the building (with two rows, one
 * checkout, the stockroom and a first stock) is 1.5 M TL.
 */
export const MARKET_OPEN_COST = 1_500_000;
export const MARKET_UNLOCKS: MarketUnlock[] = [
  { id: 'mdesk', kind: 'desk', index: 0, cost: 25000, x: 14, z: 11 },
  { id: 'checkout2', kind: 'checkout', index: 1, cost: 45000, x: 6, z: 12.6 },
  { id: 'row1', kind: 'row', index: 1, cost: 90000, x: 4, z: -4 },
  { id: 'checkout3', kind: 'checkout', index: 2, cost: 45000, x: 10, z: 12.6 },
  { id: 'row0', kind: 'row', index: 0, cost: 110000, x: 0, z: -8 },
];

/** Truck: checks the stockroom this often and restocks pallets below this share. */
export const TRUCK_EVERY = 25;
export const TRUCK_REORDER_BELOW = 0.6;

/** Seconds per item scanned at a checkout, and the most shoppers in the store at once. */
export const SCAN_INTERVAL = 0.3;
export const MAX_SHOPPERS = 26;
export const CHECKOUT_QUEUE = 5;
/** Stockers push a trolley: this many times a normal worker's load. */
export const STOCKER_CART = 3;
/** Shopping list: this many different products, each 1–3 of. */
export const LIST_KINDS: [number, number] = [3, 5];

/** Seconds between shoppers walking in: more aisles and tills bring more people. */
export const shopperInterval = (rows: number, checkouts: number) => Math.max(2, 5 - 0.6 * rows - 0.5 * checkouts);

const AVG_PRICE = Object.values(GROCERIES).reduce((s, g) => s + g.price, 0) / Object.keys(GROCERIES).length;
/** Rough TL/second the market clears (sales less wholesale) when it runs smoothly. */
export const marketRate = (rows: number, checkouts: number) =>
  ((4 * 2 * AVG_PRICE * (1 - WHOLESALE_SHARE)) / shopperInterval(rows, checkouts)) * 0.6;

/**
 * Market staff, hired at its own desk. Wages as in the shops (half a month's
 * minimum-wage employer cost up front, rising to a full month).
 */
export const MARKET_HIRES: HireDef[] = [
  { id: 'cashier', role: 'cashier', costs: [14000], counter: 0 },
  { id: 'stocker', role: 'stocker', costs: [14000, 21000, 28000], max: 20 },
  { id: 'checkout2', role: 'cashier', costs: [14000], counter: 1, requires: 'checkout2' },
  { id: 'checkout3', role: 'cashier', costs: [14000], counter: 2, requires: 'checkout3' },
];
