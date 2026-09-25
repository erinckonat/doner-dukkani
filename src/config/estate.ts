/**
 * Property on the high street: the businesses across from the shops, the two blocks
 * of flats, and a new neighbourhood (Lale Mahallesi) at the west end. Buy a building,
 * let it (houses and flats) and its rent piles up at the door; renovate for more.
 *
 * Prices (Sept 2026, Istanbul, estimates): a detached house 12–25 M TL, a block of
 * flats far more — scaled down with the game's other numbers. Rents are per second
 * (the game's clock runs fast) and repay the price in roughly seven hours of play.
 */

export type PropertyKind = 'shop' | 'flats' | 'house';

export interface PropertyDef {
  id: string;
  kind: PropertyKind;
  name: string;
  /** Facade centre (world x) and width along the street. */
  x: number;
  w: number;
  floors: number;
  price: number;
  /** TL/second when let (a shop: its takings). */
  rent: number;
  /** Houses: wall and roof colours (the old buildings keep theirs). */
  wall?: string;
  roof?: string;
}

/** A property's own business across the street keeps its id (the business's id). */
export const PROPERTIES: PropertyDef[] = [
  // Across from the shops: businesses and the two blocks of flats that are already there.
  { id: 'cafe', kind: 'shop', name: 'Köşe Kahvecisi', x: -20, w: 8, floors: 2, price: 3_000_000, rent: 110 },
  { id: 'barber', kind: 'shop', name: 'Usta Berber', x: -28.5, w: 7, floors: 2, price: 2_500_000, rent: 90 },
  { id: 'gym', kind: 'shop', name: 'Merkez Spor Salonu', x: -40, w: 14, floors: 2, price: 8_000_000, rent: 300 },
  { id: 'pide', kind: 'shop', name: 'Karadeniz Pide', x: 53, w: 9, floors: 2, price: 4_500_000, rent: 170 },
  { id: 'flats1', kind: 'flats', name: 'Çınar Apartmanı', x: -56, w: 12, floors: 4, price: 12_000_000, rent: 460 },
  { id: 'flats2', kind: 'flats', name: 'Lale Apartmanı', x: 74, w: 11, floors: 4, price: 11_000_000, rent: 420 },
  // Lale Mahallesi, west of the car gallery.
  { id: 'ev1', kind: 'house', name: 'Sarı Köşk', x: -114, w: 9, floors: 2, price: 3_500_000, rent: 130, wall: '#EFD58A', roof: '#B5462B' },
  { id: 'ev2', kind: 'house', name: 'Bahçeli Ev', x: -125, w: 9, floors: 1, price: 2_200_000, rent: 85, wall: '#E9E4DA', roof: '#6B3A2A' },
  { id: 'apt3', kind: 'flats', name: 'Güneş Apartmanı', x: -138, w: 13, floors: 4, price: 14_000_000, rent: 540, wall: '#E6C9A8' },
  { id: 'ev4', kind: 'house', name: 'Mavi Kapılı Ev', x: -151, w: 9, floors: 2, price: 3_200_000, rent: 120, wall: '#D6E2E8', roof: '#3E5A7A' },
  { id: 'ev5', kind: 'house', name: 'Taş Ev', x: -162, w: 9, floors: 2, price: 4_200_000, rent: 160, wall: '#C9C1B4', roof: '#5A463A' },
  { id: 'apt6', kind: 'flats', name: 'Yıldız Apartmanı', x: -175, w: 13, floors: 5, price: 17_000_000, rent: 660, wall: '#D9C3E0' },
  { id: 'ev7', kind: 'house', name: 'Kırmızı Çatılı Ev', x: -188, w: 9, floors: 1, price: 2_600_000, rent: 100, wall: '#F4EAD8', roof: '#C8412B' },
];

export const property = (id: string) => PROPERTIES.find((p) => p.id === id);

/** Renovation: up to this many levels, each adding this share to the rent, at this share of the price per level. */
export const RENOVATE = { max: 3, step: 0.25, cost: 0.3 };

/** An estate manager (hired at the estate office) collects every rent straight into the account. */
export const ESTATE_MANAGER_COST = 5_000_000;

/** The estate office sits between the gallery and the houses. */
export const ESTATE_OFFICE = { x: -103.5, w: 8 };
