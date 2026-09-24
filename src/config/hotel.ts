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
  buffet: [-11.6, 4.6] as P,
  pool: { x0: 5, x1: 12, z0: 4.8, z1: 8.4 },
  /** Lift pad (same spot on both floors) and the height of a storey. */
  lift: [-9.3, 0.6] as P,
  floorH: 3.4,
  /** Upper floor: a terrace along the front, a bar on it once bought. */
  terrace: { x0: -4.5, x1: 12.5, z0: 3.5, z1: 9.5 },
  bar: [8.5, 7.4] as P,
};

export interface RoomDef {
  index: number;
  /** 0 = ground floor, 1 = upstairs. */
  floor: number;
  /** Door number: 101… downstairs, 201… upstairs. */
  number: number;
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

const deluxe = (index: number, floor: number, i: number): RoomDef => {
  const x0 = -12.5 + i * W;
  const cx = x0 + W / 2;
  return {
    index, floor, number: (floor + 1) * 100 + i + 1, suite: false, x0, x1: x0 + W, z0: -9.5, z1: -4.5,
    doorX0: cx + 0.2, doorX1: cx + 1.6, wallZ: -4.5, door: [cx + 0.9, -3.4],
    bed: [cx - 0.55, -8.3], yaw: 0, bath: [cx + 1.3, -8.8], zone: [cx + 0.8, -6.4],
  };
};
const suite = (index: number, floor: number, number: number, cx: number, half: number): RoomDef => ({
  index, floor, number, suite: true, x0: cx - half, x1: cx + half, z0: -1.5, z1: 3.5,
  doorX0: cx - 1.7, doorX1: cx - 0.3, wallZ: -1.5, door: [cx - 1, -2.6],
  bed: [cx + 0.55, 2.3], yaw: Math.PI, bath: [cx - 1.4, 2.8], zone: [cx - 0.7, 0.7],
});

/**
 * Downstairs: six deluxe rooms along the back, two suites across the corridor.
 * Upstairs: the same six along the back and four suites across, over the lobby.
 */
export const ROOMS: RoomDef[] = [
  ...Array.from({ length: 6 }, (_, i) => deluxe(i, 0, i)),
  suite(6, 0, 107, 6.5, 2),
  suite(7, 0, 108, 10.5, 2),
  ...Array.from({ length: 6 }, (_, i) => deluxe(8 + i, 1, i)),
  ...[-2.375, 1.875, 6.125, 10.375].map((cx, j) => suite(14 + j, 1, 207 + j, cx, 2.125)),
];

/** The upper floor opens with its first two rooms. */
export const UPPER_START = [8, 9];

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

export interface HotelUnlock {
  id: string;
  kind: 'room' | 'desk' | 'buffet' | 'spa' | 'floor' | 'terrace';
  index: number;
  cost: number;
  x: number;
  z: number;
  floor: number;
}

const roomTile = (i: number, cost: number): HotelUnlock => {
  const r = ROOMS[i];
  return { id: `room${i}`, kind: 'room', index: i, cost, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, floor: r.floor };
};

/** Two at a time, like the shops. Room fit-outs rise; suites and amenities cost most. */
export const HOTEL_UNLOCKS: HotelUnlock[] = [
  { id: 'hdesk', kind: 'desk', index: 0, cost: 60000, x: HOTEL.desk[0], z: HOTEL.desk[1] - 1.05, floor: 0 },
  roomTile(2, 150000),
  roomTile(3, 175000),
  { id: 'buffet', kind: 'buffet', index: 0, cost: 250000, x: HOTEL.buffet[0] + 1.3, z: HOTEL.buffet[1], floor: 0 },
  roomTile(4, 200000),
  roomTile(5, 225000),
  { id: 'spa', kind: 'spa', index: 0, cost: 750000, x: (HOTEL.pool.x0 + HOTEL.pool.x1) / 2, z: (HOTEL.pool.z0 + HOTEL.pool.z1) / 2, floor: 0 },
  roomTile(6, 400000),
  roomTile(7, 450000),
  // Upstairs, once the floor is built.
  roomTile(10, 350000),
  roomTile(11, 375000),
  { id: 'terrace', kind: 'terrace', index: 0, cost: 500000, x: 4, z: 6.5, floor: 1 },
  roomTile(12, 400000),
  roomTile(13, 425000),
  roomTile(14, 800000),
  roomTile(15, 850000),
  roomTile(16, 900000),
  roomTile(17, 950000),
];

/**
 * The upper floor: structure, lift, linen room and its first two rooms. Always on
 * offer downstairs at the lift, whatever else is left to buy (an estimate).
 */
export const UPPER_FLOOR: HotelUnlock = { id: 'floor2', kind: 'floor', index: 1, cost: 3_000_000, x: HOTEL.lift[0], z: HOTEL.lift[1], floor: 0 };

/** Amenities lift every room's price. */
export const AMENITY_BONUS = { buffet: 0.15, spa: 0.25, terrace: 0.1 };

/** Room price multiplier from the amenities bought. */
export const amenityMult = (unlocked: string[]) =>
  1 + (Object.keys(AMENITY_BONUS) as (keyof typeof AMENITY_BONUS)[]).reduce((s, k) => s + (unlocked.includes(k) ? AMENITY_BONUS[k] : 0), 0);

export const HOTEL_HIRES: HireDef[] = [
  { id: 'manager', role: 'manager', costs: [60000] },
  { id: 'receptionist', role: 'receptionist', costs: [22000], counter: 0 },
  { id: 'housekeeper', role: 'housekeeper', costs: [20000, 30000, 40000], max: 20 },
];

/** Rough TL/second the hotel earns when running smoothly (a stay plus turnaround ~55 s). */
export function hotelRate(rooms: number[], unlocked: string[]) {
  const mult = amenityMult(unlocked);
  return rooms.reduce((s, i) => {
    const suite = ROOMS[i].suite;
    return s + ((suite ? ROOM_PRICE.suite : ROOM_PRICE.deluxe) * mult) / ((suite ? STAY.suite : STAY.deluxe) + 20);
  }, 0) * 0.6;
}
