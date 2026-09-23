/**
 * The businesses across the street that the player can visit. Prices are 2026 lira
 * (Sept 2026): men's haircut ~500 TL (Istanbul B-class, Denizli tariff); gym membership
 * ~3,000 TL/month, so one session ~300 TL; çay 12.50–15 TL and Türk kahvesi 65 TL
 * (İBB social facilities menu); kıymalı pide 320 TL (Asya Lahmacun).
 */

export type BuffId = 'speed' | 'carry' | 'tips';

export interface Activity {
  id: string;
  price: number;
  /** Seconds spent inside. */
  secs: number;
  buff: BuffId;
  /** speed/tips: +share (0.25 = +25%); carry: extra items. */
  amount: number;
  minutes: number;
}

export type BusinessKind = 'cafe' | 'barber' | 'pide' | 'gym' | 'bank' | 'flats';

export interface BusinessDef {
  id: string;
  kind: BusinessKind;
  /** Facade centre (world x) and width along the street. */
  x: number;
  w: number;
  /** Floors above ground (visual height). */
  floors: number;
  facade: string;
  accent: string;
  activities: Activity[];
}

/** In a row along the north side of the street, left and right of the two shops. */
export const BUSINESSES: BusinessDef[] = [
  { id: 'flats1', kind: 'flats', x: -56, w: 12, floors: 4, facade: '#D9C3A5', accent: '#8A6A4A', activities: [] },
  {
    id: 'gym', kind: 'gym', x: -40, w: 14, floors: 2, facade: '#3F4650', accent: '#E3A64A',
    activities: [{ id: 'workout', price: 300, secs: 20, buff: 'speed', amount: 0.25, minutes: 10 }],
  },
  {
    id: 'barber', kind: 'barber', x: -28.5, w: 7, floors: 2, facade: '#DCE3E6', accent: '#2F5D8C',
    activities: [{ id: 'haircut', price: 500, secs: 15, buff: 'tips', amount: 0.1, minutes: 10 }],
  },
  {
    id: 'cafe', kind: 'cafe', x: -20, w: 8, floors: 2, facade: '#E6D2B5', accent: '#6E4128',
    activities: [
      { id: 'tea', price: 15, secs: 5, buff: 'speed', amount: 0.1, minutes: 3 },
      { id: 'coffee', price: 65, secs: 8, buff: 'carry', amount: 2, minutes: 5 },
    ],
  },
  {
    id: 'pide', kind: 'pide', x: 53, w: 9, floors: 2, facade: '#EAD9BF', accent: '#B5462B',
    activities: [{ id: 'pide', price: 320, secs: 12, buff: 'carry', amount: 3, minutes: 10 }],
  },
  { id: 'bank', kind: 'bank', x: 63, w: 9, floors: 3, facade: '#E9E4DA', accent: '#3E6B5A', activities: [] },
  { id: 'flats2', kind: 'flats', x: 74, w: 11, floors: 4, facade: '#CFB89C', accent: '#7A5A3A', activities: [] },
];

/** Cost of the empty plot next door that becomes the burger shop (fit-out included). */
export const BURGER_PLOT_ID = 'gate';

export type Buffs = Partial<Record<BuffId, { until: number; amount: number }>>;

/** Active buff amount (0 when none or expired). */
export function buffAmount(buffs: Buffs | undefined, id: BuffId) {
  const b = buffs?.[id];
  return b && b.until > Date.now() ? b.amount : 0;
}
