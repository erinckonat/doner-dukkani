import { HR_POS, OFFICE_POS, SPIT_POS, SPIT_ZONE_DZ, TABLE_POS } from '../world/layout';

/**
 * Every tunable number in the game lives here.
 * Money is in 2026 Turkish lira, anchored to real prices (Sept 2026):
 * - Döner: chain-shop chicken dürüm 180–260 TL, meat dürüm ~360 TL → start 200, upgrade to 400.
 * - Burger: Whopper 285 TL (Burger King); fries medium 85 TL, milkshake medium 90 TL (McDonald's, 6 Sept 2026).
 * - Table + 2 chairs: 2,880 TL (basic) to 14,000 TL (café set).
 * - Döner spit: ~10,000 TL small gas unit; 51,200 TL industrial 8-radiant (Atalay ADG-8S).
 * - Fryer: Remta R92 3+3 L twin electric 7,290 TL. Milkshake mixer: Macap F4D twin-spindle 37,536 TL.
 * - Manager: restaurant manager ~39,800 TL/month in Istanbul (Eleman.net, 2026); hired for one month's pay.
 * - Staff: net minimum wage 28,075 TL; employer cost 40,214 TL per month. Hiring costs half a
 *   month's wage up front (~14,000 TL), rising to a full month for later hires.
 * Production is a little faster than real life so the bigger numbers keep the same pace.
 */
export const BAL = {
  player: { speed: 4.6, speedStep: 0.55, cap: 5, capStep: 2 },
  staff: { speed: 3.0, speedStep: 0.45, cap: 3, capStep: 1 },
  /** Each "price" upgrade level raises every product's price by this share of its base. */
  priceStep: 0.2,
  counterMax: 24,
  serveInterval: 0.3,
  transferInterval: 0.08,
  eatTime: 5.5,
  dineChance: 0.65,
  seatWaitTimeout: 14,
  /** Seconds in the queue before a customer gets visibly annoyed… */
  angryAfter: 20,
  /** …and before they walk out without buying, if nobody has started serving them. */
  giveUpAfter: 60,
  maxCustomers: 30,
  maxOrder: 3,
  customerSpeed: 2.4,
  online: {
    /** Online menu prices are this much above the shop's (döner 200 → 250 TL). */
    markup: 0.25,
    /** Paid to the courier for each delivery. */
    courierFee: 50,
    interval: [20, 36] as [number, number],
    maxActive: 2,
    maxOrder: 3,
    /** Online orders start coming in once this unlock is bought. */
    startsAfter: 'office',
  },
  /** While the game is closed, staffed shops keep earning for up to this long… */
  offlineCapSec: 8 * 60 * 60,
  /** …at this share of their normal rate (nobody is there to help the staff). */
  offlineRate: 0.35,
  /** Share of a shop's staffed income it keeps earning while the player is in the other shop. */
  idleRate: 0.35,
};

export type UpgradeId = 'pSpeed' | 'pCap' | 'price' | 'sSpeed' | 'sCap';

export interface UpgradeDef { id: UpgradeId; baseCost: number; growth: number; max: number }

export const UPGRADES: UpgradeDef[] = [
  { id: 'pSpeed', baseCost: 5000, growth: 1.9, max: 5 },
  { id: 'pCap', baseCost: 7500, growth: 1.9, max: 5 },
  { id: 'price', baseCost: 10000, growth: 2.0, max: 5 },
  { id: 'sSpeed', baseCost: 15000, growth: 1.9, max: 5 },
  { id: 'sCap', baseCost: 20000, growth: 1.9, max: 5 },
];

export const upgradeCost = (d: UpgradeDef, level: number) =>
  Math.round((d.baseCost * Math.pow(d.growth, level)) / 500) * 500;

/** Upgrades sold at each desk. */
export const OFFICE_UPGRADES: UpgradeId[] = ['pSpeed', 'pCap', 'price'];
export const HR_UPGRADES: UpgradeId[] = ['sSpeed', 'sCap'];

// ---------- products ----------

export type ProductKind = 'doner' | 'burger' | 'fries' | 'shake';

export interface ProductDef {
  kind: ProductKind;
  /** Shop price at upgrade level 0, in TL. */
  price: number;
  /** Seconds per item from one machine. */
  interval: number;
  trayMax: number;
}

export const PRODUCTS: Record<ProductKind, ProductDef> = {
  doner: { kind: 'doner', price: 200, interval: 1.5, trayMax: 10 },
  burger: { kind: 'burger', price: 280, interval: 1.2, trayMax: 10 },
  fries: { kind: 'fries', price: 85, interval: 1.1, trayMax: 10 },
  // A twin-spindle mixer makes two cups at a time.
  shake: { kind: 'shake', price: 90, interval: 1.0, trayMax: 10 },
};

/**
 * Extra machines bought at the office (Sept 2026 list prices): industrial 8-radiant döner spit
 * 51,200 TL (Atalay ADG-8S); 50 cm electric flat grill 6,500 TL (Remta R83); twin fryer
 * 7,290 TL (Remta R92); twin-spindle milkshake mixer 37,536 TL (Macap F4D).
 */
export const MACHINE_PRICE: Record<ProductKind, number> = { doner: 51200, burger: 6500, fries: 7290, shake: 37536 };

export const priceOf = (kind: ProductKind, priceLevel: number) =>
  Math.round(PRODUCTS[kind].price * (1 + BAL.priceStep * priceLevel));

// ---------- shops ----------

export type ShopId = 'doner' | 'burger';
export type StaffRole = 'manager' | 'cashier' | 'carrier' | 'cleaner' | 'stocker' | 'receptionist' | 'housekeeper';
export type UnlockKind = 'table' | 'producer' | 'office' | 'hr' | 'window';

export interface UnlockDef {
  id: string;
  kind: UnlockKind;
  cost: number;
  x: number;
  z: number;
  index?: number;
}

export type HireId = 'manager' | 'cashier' | 'carrier' | 'cleaner' | 'cashierWindow' | 'stocker' | 'checkout2' | 'checkout3'
  | 'receptionist' | 'housekeeper';

export interface HireDef {
  id: HireId;
  role: StaffRole;
  /** Price of each successive hire; its length is the headcount unless `max` says otherwise. */
  costs: number[];
  /** Headcount limit when more than `costs` lists; later hires cost the last price. */
  max?: number;
  counter?: number;
  /** Unlock id that must be bought before this hire is offered. */
  requires?: string;
}

export const hireMax = (h: HireDef) => h.max ?? h.costs.length;
export const hireCost = (h: HireDef, n: number) => h.costs[Math.min(n, h.costs.length - 1)];

/** A kitchen machine on one of the three back-wall slots (SPIT_POS). */
export interface ProducerDef {
  product: ProductKind;
  slot: number;
  /** Unlock that installs it; absent means it's there from the start. */
  unlock?: string;
}

export interface ShopTheme {
  floorA: string;
  floorB: string;
  kitchen: string;
  wall: string;
  stripe: string;
  chair: string;
  chairDark: string;
}

export interface ShopDef {
  id: ShopId;
  /** The product every customer orders; the others are extras. */
  main: ProductKind;
  producers: ProducerDef[];
  /** Appear in this order, two at a time. */
  unlocks: UnlockDef[];
  hires: HireDef[];
  theme: ShopTheme;
  /** Cost to open this shop from the other one's gate (0 = the starting shop). */
  openCost: number;
}

const table = (id: string, index: number, cost: number): UnlockDef =>
  ({ id, kind: 'table', index, cost, x: TABLE_POS[index][0], z: TABLE_POS[index][1] });
const machine = (id: string, slot: number, cost: number): UnlockDef =>
  ({ id, kind: 'producer', index: slot, cost, x: SPIT_POS[slot][0], z: SPIT_POS[slot][1] + SPIT_ZONE_DZ });
const office = (cost: number): UnlockDef => ({ id: 'office', kind: 'office', cost, x: OFFICE_POS[0], z: OFFICE_POS[1] });
const hr = (cost: number): UnlockDef => ({ id: 'hr', kind: 'hr', cost, x: HR_POS[0], z: HR_POS[1] });
const driveWindow = (cost: number): UnlockDef => ({ id: 'window', kind: 'window', cost, x: -8.95, z: 3.55 });

/** Staff hired at the HR desk, in the order the panel lists them. */
const STAFF: HireDef[] = [
  { id: 'manager', role: 'manager', costs: [40000] },
  { id: 'cashier', role: 'cashier', costs: [14000], counter: 0 },
  // As many waiters as you like: after the third, each costs a full month's wage.
  { id: 'carrier', role: 'carrier', costs: [14000, 21000, 28000], max: 30 },
  { id: 'cleaner', role: 'cleaner', costs: [14000, 21000] },
  { id: 'cashierWindow', role: 'cashier', costs: [28000], counter: 1, requires: 'window' },
];

export const SHOPS: Record<ShopId, ShopDef> = {
  doner: {
    id: 'doner',
    main: 'doner',
    producers: [
      { product: 'doner', slot: 0 },
      { product: 'doner', slot: 1, unlock: 'spit2' },
      { product: 'doner', slot: 2, unlock: 'spit3' },
    ],
    unlocks: [
      table('table1', 0, 3000),
      table('table2', 1, 3500),
      office(7500),
      machine('spit2', 1, 12000),
      table('table3', 2, 6000),
      hr(10000),
      table('table4', 3, 8000),
      machine('spit3', 2, 51000),
      table('table5', 4, 12500),
      table('table6', 5, 14000),
      driveWindow(75000),
    ],
    hires: STAFF,
    theme: {
      floorA: '#EFE2CB', floorB: '#E4D0B0', kitchen: '#D8C0A0', wall: '#E3CCAE',
      stripe: '#C8412B', chair: '#C8412B', chairDark: '#9E2F1E',
    },
    openCost: 0,
  },
  burger: {
    id: 'burger',
    main: 'burger',
    producers: [
      { product: 'burger', slot: 0 },
      { product: 'fries', slot: 1, unlock: 'fryer' },
      { product: 'shake', slot: 2, unlock: 'shaker' },
    ],
    unlocks: [
      table('table1', 0, 3000),
      table('table2', 1, 3500),
      machine('fryer', 1, 7300),
      office(7500),
      table('table3', 2, 6000),
      hr(10000),
      machine('shaker', 2, 37500),
      table('table4', 3, 8000),
      table('table5', 4, 12500),
      table('table6', 5, 14000),
      driveWindow(75000),
    ],
    hires: STAFF,
    theme: {
      floorA: '#F3E6CF', floorB: '#DDBF8F', kitchen: '#CBBBA4', wall: '#EBD8BE',
      stripe: '#E3A64A', chair: '#D98C2B', chairDark: '#A8641A',
    },
    // A second shop's fit-out: lease deposit, kitchen and furniture.
    openCost: 250000,
  },
};
