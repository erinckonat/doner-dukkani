import type { HireDef } from './balance';

/**
 * Lale Park AVM: a three-storey shopping mall at the east end of the high street.
 * The shops are let to tenants; the player owns the building. Rent comes in with
 * every purchase and piles up in the management office's safe until it's collected;
 * the food court's tables need clearing and the cinema's showings need starting.
 *
 * Money (Sept 2026, estimates): a city-centre mall of this size costs far more in
 * reality; 22 M TL buys the shell with its ground floor and two starter tenants.
 * Cinema tickets ~300 TL (Istanbul multiplex, weekend). Rent per purchase stands
 * for turnover rent (a share of each sale), sped up like everything else.
 */

/** Where the mall's local origin sits in the city: east of the hotel, front on the street. */
export const MALL_ORIGIN = { x: 152, z: -12.5 };

type P = [number, number];

export const MALL = {
  halfW: 30,
  halfD: 21,
  /** Height of a storey. */
  floorH: 3.6,
  /** Promenade between the two rows of shops (z range). */
  prom: { z0: -6, z1: 8 },
  /** The escalator island in the middle of the promenade; its pads sit at either end. */
  island: { x0: -3.2, x1: 3.2, z0: -1, z1: 5 },
  upPad: [-2.5, 5.6] as P,
  upTop: [-2.5, -1.6] as P,
  downPad: [2.5, -1.6] as P,
  downFoot: [2.5, 5.6] as P,
  /** Two sets of glass doors in the front wall (x ranges). */
  entrances: [{ x0: -5, x1: -1 }, { x0: 1, x1: 5 }],
  /** Visitors arrive and leave along the pavement here (local z). */
  street: 26,
  /** Management office (ground floor, south row): walls, door gap, the HR desk and the rent safe. */
  office: { x0: 6, x1: 18, z0: 8, z1: 21, doorX0: 10.5, doorX1: 13 },
  desk: [14.5, 16] as P,
  safe: [8.4, 18.6] as P,
  /** Food court (top floor, south of the promenade): tables and the bin. */
  tables: [
    [2, 11], [6.5, 11], [11, 11], [15.5, 11], [20, 11], [24.5, 11],
    [2, 15.5], [6.5, 15.5], [11, 15.5], [15.5, 15.5], [20, 15.5], [24.5, 15.5],
  ] as P[],
  bin: [27.5, 18.5] as P,
  /** Cinema: its hall is the big unit on the top floor; the queue forms outside its door. */
  cinemaSeats: 24,
  ticket: 300,
  /** Seconds a film runs once the doors close. */
  filmSecs: 35,
};

export type UnitKind = 'clothes' | 'sport' | 'shoes' | 'beauty' | 'tech' | 'toys' | 'arcade' | 'books' | 'home' | 'food' | 'cinema';

export interface UnitDef {
  id: string;
  floor: number;
  /** North row (back, door facing +z) or south row (front, door facing -z). */
  row: 'n' | 's';
  x0: number;
  x1: number;
  kind: UnitKind;
  brand: string;
  /** Tagline under the brand on its sign. */
  tag: string;
  color: string;
  accent: string;
  cost: number;
  /** TL that lands in the rent safe with each purchase. */
  rent: number;
  /** Comes with the building (the two starter tenants). */
  starter?: boolean;
}

const u = (id: string, floor: number, row: 'n' | 's', x0: number, x1: number, kind: UnitKind, brand: string, tag: string, color: string, accent: string, cost: number, rent: number, starter = false): UnitDef =>
  ({ id, floor, row, x0, x1, kind, brand, tag, color, accent, cost, rent, starter });

/** In the order they come up for letting, floor by floor (two at a time on each floor). */
export const MALL_UNITS: UnitDef[] = [
  // Ground floor.
  u('elsi', 0, 'n', -30, -18, 'clothes', 'El Si Vaykiki', 'Herkes iyi giyinmeyi hak eder', '#2F4B8C', '#E3A64A', 0, 2600, true),
  u('gratiz', 0, 'n', -9, 0, 'beauty', 'Gratiz', 'Güzellik bedava değil ama ucuz', '#6B2E6B', '#F4B6C2', 0, 1800, true),
  u('zaraa', 0, 'n', -18, -9, 'clothes', 'Zaraa', 'Moda, iki A ile', '#2A1E18', '#EDE6D8', 900000, 2400),
  u('sefora', 0, 'n', 0, 9, 'beauty', 'Sefora Güzellik', 'Parfüm, ruj, ışıltı', '#1E1E1E', '#E9E4DA', 1100000, 2200),
  u('medya', 0, 'n', 9, 18, 'tech', 'Medya Pazarı', 'Ben aptal değilim ki', '#B5262B', '#EDE6D8', 1600000, 3600),
  u('elma', 0, 'n', 18, 30, 'tech', 'Elma Mağazası', 'Düşün farklı, öde fazla', '#E9E4DA', '#3A3F4A', 2200000, 4200),
  u('hn', 0, 's', -30, -18, 'clothes', 'H&N', 'Hızlı moda, hızlı kasa', '#C8412B', '#FFFAF0', 1300000, 2400),
  u('vatsons', 0, 's', -18, -6, 'beauty', 'Vatsons', 'Kendine iyi bak', '#1F7A7A', '#FFFAF0', 1000000, 1900),
  u('floflo', 0, 's', 18, 30, 'shoes', 'Flo-Flo Ayakkabı', 'Her adımda indirim', '#D95B2B', '#FFFAF0', 1200000, 2100),
  // First floor.
  u('defakto', 1, 'n', -30, -18, 'clothes', 'DeFakto', 'Aslında moda', '#1E4F9C', '#FFFAF0', 1500000, 2500),
  u('kotoncuk', 1, 'n', -18, -9, 'clothes', 'Kotoncuk', 'Pamuk gibi fiyatlar', '#3A3F4A', '#E3A64A', 1400000, 2300),
  u('sayfa', 1, 'n', -9, 0, 'books', 'Sayfa Arası', 'Kitap & Kahve', '#3E6B5A', '#E9D9B6', 900000, 1400),
  u('oyunzz', 1, 'n', 0, 9, 'toys', 'Oyunzz Şop', 'Büyüklere de oyuncak', '#E3A64A', '#2F5D8C', 1300000, 1900),
  u('nese', 1, 'n', 9, 30, 'arcade', 'NeşePark', 'Jeton at, neşeyi kap', '#5B2E8C', '#F2C230', 2800000, 3000),
  u('lacivert', 1, 's', -30, -18, 'clothes', 'Lacivert Jeans', 'Kotun lacivert hali', '#27406B', '#E9E4DA', 1500000, 2400),
  u('nayki', 1, 's', -18, -6, 'sport', 'Naykı Spor', 'Sadece koş', '#1E1E1E', '#F2F2EE', 1800000, 2800),
  u('teknosaa', 1, 's', 6, 18, 'tech', 'TeknoSaa', 'Teknoloji, taksit taksit', '#1D4E89', '#F2C230', 1900000, 3300),
  u('koko', 1, 's', 18, 30, 'home', 'Madam Koko Ev', 'Evin şıkırtısı', '#8A5A6A', '#F4EAD8', 1200000, 1800),
  // Top floor: the cinema and the food court's stands.
  u('sinema', 2, 'n', -30, -6, 'cinema', 'Sinemaksimum', 'Dev ekran, bol mısır', '#2A1E18', '#E3A64A', 3000000, 0),
  u('doner', 2, 'n', -6, 0, 'food', 'Döner Dükkanı Ekspres', 'Caddenin dönercisi, AVM\'de', '#C8412B', '#F4EAD8', 700000, 1500),
  u('burger', 2, 'n', 0, 6, 'food', 'Burger Dükkanı', 'Menü kutusuyla', '#D98C2B', '#2A1E18', 700000, 1500),
  u('simit', 2, 'n', 6, 12, 'food', 'Simit Konağı', 'Susam bol, çay taze', '#B5462B', '#F2C230', 600000, 900),
  u('kahve', 2, 'n', 12, 18, 'food', 'Kahve Evreni', 'Bir fincan, kırk yıl', '#5A3A2A', '#E3A64A', 600000, 1000),
  u('kofte', 2, 'n', 18, 24, 'food', 'Köfteci Yusufçuk', 'Izgarada tek tip mutluluk', '#8A2E1E', '#F4EAD8', 700000, 1100),
  u('tavuk', 2, 'n', 24, 30, 'food', 'Tavukçu Dünyası', 'Her şey tavuk', '#E0A22B', '#6B2E2E', 700000, 1100),
];

/** Upper floors, bought at the foot of the up escalator on the floor below. */
export const MALL_FLOORS = [
  { id: 'mfloor1', floor: 1, cost: 4_000_000 },
  { id: 'mfloor2', floor: 2, cost: 8_000_000 },
];

export const MALL_OPEN_COST = 22_000_000;

export const MALL_HIRES: HireDef[] = [
  { id: 'accountant', role: 'accountant', costs: [45000] },
  { id: 'mallCleaner', role: 'cleaner', costs: [20000, 30000, 40000], max: 6, requires: 'mfloor2' },
  { id: 'usher', role: 'usher', costs: [25000], requires: 'mfloor2' },
];

/** Visitors: seconds between arrivals at base, shops each visits, and how many are in at once. */
export const VISITOR = { every: 2.4, stops: [2, 4] as [number, number], max: 36, parkingStep: 8, adsStep: 0.2, rentStep: 0.15 };
