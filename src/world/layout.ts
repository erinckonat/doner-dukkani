// Layout in metres. Everything about a shop is in its own local frame (interior x -10..10,
// z -9..9, door on the +z wall); each shop sits in the city at its SHOP_ORIGIN_X.

export const ROOM = { minX: -10, maxX: 10, minZ: -9, maxZ: 9 };
export const WORLD = { minX: -18, maxX: 14, minZ: -10.5, maxZ: 14 };
export const DOOR = { x0: -1.6, x1: 1.6 };

export const TABLE_POS: [number, number][] = [
  [3.4, -5.6], [6.9, -5.6],
  [3.4, -2.1], [6.9, -2.1],
  [3.4, 1.4], [6.9, 1.4],
];
export const SPIT_POS: [number, number][] = [[-4.5, -8], [-7, -8], [-2, -8]];
/** Pickup zone sits this far in front of the spit centre. */
export const SPIT_ZONE_DZ = 1.7;

export const OFFICE_POS: [number, number] = [-7.6, 6.6];
export const HR_POS: [number, number] = [6.9, 7.3];
/** Where new hires appear before walking in through the door. */
export const STAFF_ENTRY: [number, number] = [0, 11];
/** Idle spots per role: carriers wait by the kitchen, cleaners between the table rows. */
export const STAFF_HOMES: Record<'carrier' | 'cleaner', [number, number][]> = {
  carrier: [[-0.4, -5.2], [0.4, -5.8], [-0.4, -6.4]],
  cleaner: [[5.15, -0.35], [3.9, -0.35]],
};
// Centre of the dining area, between the first four tables.
export const BIN_POS: [number, number] = [5.15, -3.85];
export const WAIT_SPOT: [number, number] = [1.4, 5.4];
export const START_POS: [number, number] = [-3.2, -5];
/** Couriers ride along the near lane of the road and park here. */
export const COURIER_LANE_Z = 16.2;
export const COURIER_PARK_X = 4.5;
/** Drive-thru road along the shop's left wall; cars drive toward +z past the takeaway window. */
export const DRIVE_ROAD = { x0: -14.1, x1: -10.9, laneX: -12.3, z0: -45, z1: 45 };

/** Where each shop's local origin sits along the high street (world x). */
export const SHOP_ORIGIN_X = { doner: 0, burger: 34 } as const;

/** The city: a high street running along x in front of the shops. */
export const CITY = {
  minX: -64, maxX: 84, minZ: -11.5, maxZ: 30,
  /** Road surface and its lanes (couriers and drive-thru exits use the north lane, heading +x). */
  road: { z0: 15.1, z1: 20.1, northLane: 16.2, southLane: 18.9 },
  /** Kerbside walking lines for passers-by. */
  walk: { north: 14.2, south: 21.4 },
  /**
   * Businesses stand in a row with the shops, facades on this line facing the street.
   * (The camera looks from the south, so the far side of the road is kept low: a park.)
   */
  northFront: 9.3,
};
