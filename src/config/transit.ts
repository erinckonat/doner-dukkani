/**
 * Bus stops along the high street: stand at one and ride to any other. Fare: an
 * Istanbul single bus ride, Sept 2026 (estimate, ~35 TL).
 */
export interface Stop { id: string; name: string; x: number }

export const STOPS: Stop[] = [
  { id: 'hood', name: 'Lale Mahallesi', x: -150 },
  { id: 'gallery', name: 'Oto Galeri', x: -74 },
  { id: 'center', name: 'Döner Dükkanı', x: 5 },
  { id: 'burger', name: 'Burger Dükkanı', x: 40 },
  { id: 'side', name: 'Market & Otel', x: 96 },
  { id: 'mall', name: 'Lale Park AVM', x: 160 },
];

export const BUS_FARE = 35;
/** The stops stand on the pavement by the kerb. */
export const STOP_Z = 13.4;
