import { HR_POS, OFFICE_POS, SPIT_POS, SPIT_ZONE_DZ, TABLE_POS } from '../world/layout';

/**
 * Every tunable number in the game lives here.
 * Money is in 2026 Turkish lira, anchored to real prices (Sept 2026):
 * - Döner: chain-shop chicken dürüm 180–260 TL, meat dürüm ~360 TL → start 200, upgrade to 400.
 * - Table + 2 chairs: 2,880 TL (basic) to 14,000 TL (café set).
 * - Döner spit: ~10,000 TL small gas unit; 51,200 TL industrial 8-radiant (Atalay ADG-8S).
 * - Staff: net minimum wage 28,075 TL; employer cost 40,214 TL per month. Hiring costs half a
 *   month's wage up front (~14,000 TL), rising to a full month for later hires.
 * Production is a little faster than real life so the bigger numbers keep the same pace.
 */
export const BAL = {
  player: { speed: 4.6, speedStep: 0.55, cap: 5, capStep: 2 },
  staff: { speed: 3.0, speedStep: 0.45, cap: 3, capStep: 1 },
  price: { base: 200, step: 40 },
  spit: { interval: 1.5, trayMax: 10 },
  counterMax: 24,
  serveInterval: 0.3,
  transferInterval: 0.08,
  eatTime: 5.5,
  dineChance: 0.65,
  seatWaitTimeout: 14,
  angryAfter: 18,
  maxCustomers: 30,
  maxOrder: 3,
  customerSpeed: 2.4,
  online: {
    /** Online menu price is the shop price plus this (200 → 250 TL). */
    markup: 50,
    /** Paid to the courier for each delivery. */
    courierFee: 50,
    interval: [20, 36] as [number, number],
    maxActive: 2,
    maxOrder: 3,
    /** Online orders start coming in once this unlock is bought. */
    startsAfter: 'office',
  },
  offlineCapSec: 2 * 60 * 60,
  offlineRate: 0.25,
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

export type StaffRole = 'cashier' | 'carrier' | 'cleaner';
export type UnlockKind = 'table' | 'spit' | 'office' | 'hr' | 'window';

export interface UnlockDef {
  id: string;
  kind: UnlockKind;
  cost: number;
  x: number;
  z: number;
  index?: number;
}

const table = (id: string, index: number, cost: number): UnlockDef =>
  ({ id, kind: 'table', index, cost, x: TABLE_POS[index][0], z: TABLE_POS[index][1] });
const spit = (id: string, index: number, cost: number): UnlockDef =>
  ({ id, kind: 'spit', index, cost, x: SPIT_POS[index][0], z: SPIT_POS[index][1] + SPIT_ZONE_DZ });

/** Unlocks appear in this order, two at a time. */
export const UNLOCKS: UnlockDef[] = [
  table('table1', 0, 3000),
  table('table2', 1, 3500),
  { id: 'office', kind: 'office', cost: 7500, x: OFFICE_POS[0], z: OFFICE_POS[1] },
  spit('spit2', 1, 12000),
  table('table3', 2, 6000),
  { id: 'hr', kind: 'hr', cost: 10000, x: HR_POS[0], z: HR_POS[1] },
  table('table4', 3, 8000),
  spit('spit3', 2, 51000),
  table('table5', 4, 12500),
  table('table6', 5, 14000),
  { id: 'window', kind: 'window', cost: 75000, x: -8.95, z: 3.55 },
];

export type HireId = 'cashier' | 'carrier' | 'cleaner' | 'cashierWindow';

export interface HireDef {
  id: HireId;
  role: StaffRole;
  /** Price of each successive hire; its length is the maximum headcount. */
  costs: number[];
  counter?: number;
  /** Unlock id that must be bought before this hire is offered. */
  requires?: string;
}

/** Staff hired at the HR desk, in the order the panel lists them. */
export const HIRES: HireDef[] = [
  { id: 'cashier', role: 'cashier', costs: [14000], counter: 0 },
  { id: 'carrier', role: 'carrier', costs: [14000, 21000, 28000] },
  { id: 'cleaner', role: 'cleaner', costs: [14000, 21000] },
  { id: 'cashierWindow', role: 'cashier', costs: [28000], counter: 1, requires: 'window' },
];

/** Upgrades sold at each desk. */
export const OFFICE_UPGRADES: UpgradeId[] = ['pSpeed', 'pCap', 'price'];
export const HR_UPGRADES: UpgradeId[] = ['sSpeed', 'sCap'];
