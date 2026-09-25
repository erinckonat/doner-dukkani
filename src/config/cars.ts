/**
 * Cars: what the gallery sells, and what the player can drive. Prices are Sept 2026
 * list prices rounded (estimates for the imports); the names are affectionate parodies.
 * `speed` is the player's driving speed in m/s.
 */
export type CarStyle = 'classic' | 'hatch' | 'sedan' | 'suv' | 'sport';

export interface CarModel {
  id: string;
  name: string;
  style: CarStyle;
  price: number;
  speed: number;
  paint: string;
  /** How often it turns up on the gallery floor, relative to the others. */
  weight: number;
}

export const CAR_MODELS: CarModel[] = [
  { id: 'sahane', name: 'Tofaş Şahane', style: 'classic', price: 650_000, speed: 10, paint: '#C8B89A', weight: 5 },
  { id: 'ege', name: 'Fiyaat Eğe', style: 'sedan', price: 1_300_000, speed: 12, paint: '#D9D2C5', weight: 6 },
  { id: 'kliyo', name: 'Renö Kliyo', style: 'hatch', price: 1_500_000, speed: 13, paint: '#B8473A', weight: 5 },
  { id: 'tog', name: 'Tog T10', style: 'suv', price: 2_400_000, speed: 14, paint: '#3F6E8C', weight: 4 },
  { id: 'pasat', name: 'Folksvagın Pasat', style: 'sedan', price: 2_800_000, speed: 15, paint: '#4A4550', weight: 4 },
  { id: 'teslaa', name: 'Teslaa Model Ş', style: 'sedan', price: 3_500_000, speed: 17, paint: '#E9E4DA', weight: 3 },
  { id: 'bemeve', name: 'BeMeVe 5', style: 'sedan', price: 5_500_000, speed: 18, paint: '#1F2A3A', weight: 2 },
  { id: 'porse', name: 'Porşe 911', style: 'sport', price: 9_000_000, speed: 21, paint: '#E3A64A', weight: 1 },
];

export const carModel = (id: string) => CAR_MODELS.find((c) => c.id === id)!;

/** The gallery's cut when it sells a car (the rest paid the importer). */
export const CAR_MARGIN = 0.025;
