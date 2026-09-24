import type { HireDef } from './balance';

/**
 * The five-star hotel on the high street, in the garden east of the market's side
 * street. Guests check in at reception, pay for the night, sleep, and leave the room
 * to be made up: fresh towels from the laundry and the bed made.
 *
 * Prices (Sept 2026): Istanbul five-star hotels list from 3,264 TL a night (Enuygun,
 * lowest listed rate); a city-centre deluxe room is set well above that at 7,500 TL
 * and a suite at 18,000 TL (estimates). Housekeepers average 39,124 TL a month
 * (ElemanBuldum, Mar 2026), hired for half a month up front like the other staff.
 * The building, fit-out and amenity costs are estimates.
 */

/** Where the hotel's local origin sits in the city (world x, z). */
export const HOTEL_ORIGIN = { x: 104.5, z: -1 };

type P = [number, number];

export const HOTEL = {
  halfW: 12.5,
  halfD: 9.5,
  door: { x0: -1.5, x1: 1.5 },
  /** Reception desk (centre); the receptionist stands behind (north), guests queue in front. */
  reception: [-6, 3] as P,
  receptionLen: 3,
  /** Laundry: a washer at the corridor's west end turning out fresh towels. */
  laundry: [-11.6, -3] as P,
  desk: [-10.5, 7.2] as P,
  buffet: [-11.6, 0.9] as P,
  pool: { x0: 5, x1: 12, z0: 4.8, z1: 8.4 },
};

export interface RoomDef {
  index: number;
  suite: boolean;
  x0: number; x1: number; z0: number; z1: number;
  /** Door gap along the corridor wall (x range) and that wall's z. */
  doorX0: number; doorX1: number; wallZ: number;
  /** Just outside the door, in the corridor. */
  door: P;
  /** Bed centre and the way the pillow end points (yaw: 0 = head to -z, π = head to +z). */
  bed: P;
  yaw: number;
  bath: P;
  /** Where housekeeping stands to make up the room. */
  zone: P;
}

const W = 25 / 6;

/** Six deluxe rooms along the back, two suites facing them across the corridor. */
export const ROOMS: RoomDef[] = [
  ...Array.from({ length: 6 }, (_, i): RoomDef => {
    const x0 = -12.5 + i * W;
    const cx = x0 + W / 2;
    return {
      index: i, suite: false, x0, x1: x0 + W, z0: -9.5, z1: -4.5,
      doorX0: cx + 0.2, doorX1: cx + 1.6, wallZ: -4.5, door: [cx + 0.9, -3.4],
      bed: [cx - 0.55, -8.3], yaw: 0, bath: [cx + 1.3, -8.8], zone: [cx + 0.8, -6.4],
    };
  }),
  ...[6.5, 10.5].map((cx, j): RoomDef => ({
    index: 6 + j, suite: true, x0: cx - 2, x1: cx + 2, z0: -1.5, z1: 3.5,
    doorX0: cx - 1.7, doorX1: cx - 0.3, wallZ: -1.5, door: [cx - 1, -2.6],
    bed: [cx + 0.55, 2.3], yaw: Math.PI, bath: [cx - 1.4, 2.8], zone: [cx - 0.7, 0.7],
  })),
];

export const STARTING_ROOMS = [0, 1];

export const ROOM_PRICE = { deluxe: 7500, suite: 18000 };
/** Seconds a guest spends in the room (a night, sped up). */
export const STAY = { deluxe: 35, suite: 45 };
/** Seconds of bed-making once someone is in the room. */
export const CLEAN_TIME = 2.5;
export const TOWEL_EVERY = 1.6;
export const TOWEL_TRAY = 12;
export const RECEPTION_QUEUE = 5;
export const CHECKIN_TIME = 0.8;

/** Building and fit-out of a five-star city hotel (lobby, two rooms, laundry): an estimate. */
export const HOTEL_OPEN_COST = 6_000_000;

export interface HotelUnlock { id: string; kind: 'room' | 'desk' | 'buffet' | 'spa'; index: number; cost: number; x: number; z: number }

const roomTile = (i: number, cost: number): HotelUnlock => {
  const r = ROOMS[i];
  return { id: `room${i}`, kind: 'room', index: i, cost, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
};

/** Two at a time, like the shops. Room fit-outs rise; suites and amenities cost most. */
export const HOTEL_UNLOCKS: HotelUnlock[] = [
  { id: 'hdesk', kind: 'desk', index: 0, cost: 60000, x: HOTEL.desk[0], z: HOTEL.desk[1] - 1.05 },
  roomTile(2, 150000),
  roomTile(3, 175000),
  { id: 'buffet', kind: 'buffet', index: 0, cost: 250000, x: HOTEL.buffet[0] + 1.3, z: HOTEL.buffet[1] },
  roomTile(4, 200000),
  roomTile(5, 225000),
  { id: 'spa', kind: 'spa', index: 0, cost: 750000, x: (HOTEL.pool.x0 + HOTEL.pool.x1) / 2, z: (HOTEL.pool.z0 + HOTEL.pool.z1) / 2 },
  roomTile(6, 400000),
  roomTile(7, 450000),
];

/** Amenities lift every room's price. */
export const AMENITY_BONUS = { buffet: 0.15, spa: 0.25 };

export const HOTEL_HIRES: HireDef[] = [
  { id: 'manager', role: 'manager', costs: [60000] },
  { id: 'receptionist', role: 'receptionist', costs: [22000], counter: 0 },
  { id: 'housekeeper', role: 'housekeeper', costs: [20000, 30000, 40000], max: 20 },
];

/** Rough TL/second the hotel earns when running smoothly (a stay plus turnaround ~55 s). */
export function hotelRate(rooms: number[], unlocked: string[]) {
  const mult = 1 + (unlocked.includes('buffet') ? AMENITY_BONUS.buffet : 0) + (unlocked.includes('spa') ? AMENITY_BONUS.spa : 0);
  return rooms.reduce((s, i) => {
    const suite = ROOMS[i].suite;
    return s + ((suite ? ROOM_PRICE.suite : ROOM_PRICE.deluxe) * mult) / ((suite ? STAY.suite : STAY.deluxe) + 20);
  }, 0) * 0.6;
}
