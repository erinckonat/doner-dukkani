import { SHOPS, type ShopId } from '../config/balance';
import { HOTEL_UNLOCKS, UPPER_FLOOR } from '../config/hotel';
import { PROPERTIES } from '../config/estate';
import { MALL_FLOORS, MALL_UNITS } from '../config/mall';
import { MARKET_UNLOCKS } from '../config/market';
import { freshStats, type SaveData, type ShopState } from '../core/Save';
import { fmtMoney } from '../ui/Hud';

/** One step on the way from a single döner spit to the whole street. */
export interface GoalDef {
  id: string;
  text: string;
  target: number;
  /** Progress towards `target`, read from the save. */
  progress: (d: SaveData) => number;
}

const stats = (d: SaveData) => (d.stats ??= freshStats());
const tables = (st?: ShopState) => st?.unlocked.filter((u) => u.startsWith('table')).length ?? 0;
const has = (st: ShopState | undefined, id: string) => (st?.unlocked.includes(id) ? 1 : 0);
const shopDone = (st: ShopState | undefined, id: ShopId) =>
  st ? SHOPS[id].unlocks.filter((u) => st.unlocked.includes(u.id)).length : 0;
const hotelIds = [...HOTEL_UNLOCKS, UPPER_FLOOR].map((u) => u.id);
const managers = (d: SaveData) =>
  [d, d.burger, d.market, d.hotel].filter((st) => (st?.hires.manager ?? 0) > 0).length;

/** In the order a player meets them: the döner shop, then the street, then the city. */
export const GOALS: GoalDef[] = [
  { id: 'serve10', text: '10 müşteriye servis yap', target: 10, progress: (d) => stats(d).served },
  { id: 'tables2', text: 'Döner dükkanında 2 masa aç', target: 2, progress: (d) => tables(d) },
  { id: 'office', text: 'Yönetim masasını kur', target: 1, progress: (d) => has(d, 'office') },
  { id: 'speed', text: 'Yönetim masasında yürüme hızını artır', target: 1, progress: (d) => d.upg.pSpeed ?? 0 },
  { id: 'tea', text: 'Karşıdaki kahvecide bir çay iç', target: 1, progress: (d) => stats(d).visits },
  { id: 'online1', text: 'İlk online siparişi kuryeye teslim et', target: 1, progress: (d) => stats(d).online },
  { id: 'spit2', text: '2. döner ocağını kur', target: 1, progress: (d) => has(d, 'spit2') },
  { id: 'cashier', text: 'İK masasından bir kasiyer al', target: 1, progress: (d) => d.hires.cashier ?? 0 },
  { id: 'earn100k', text: `Toplam ${fmtMoney(100_000)} satış yap`, target: 100_000, progress: (d) => stats(d).earned },
  { id: 'price2', text: 'Döner fiyatını 2 kez artır', target: 2, progress: (d) => d.upg.price ?? 0 },
  { id: 'carrier2', text: '2 garson çalıştır', target: 2, progress: (d) => d.hires.carrier ?? 0 },
  { id: 'spit3', text: '3. döner ocağını kur', target: 1, progress: (d) => has(d, 'spit3') },
  { id: 'window', text: 'Paket servis penceresini aç', target: 1, progress: (d) => has(d, 'window') },
  { id: 'donerDone', text: 'Döner dükkanını %100 tamamla', target: SHOPS.doner.unlocks.length, progress: (d) => shopDone(d, 'doner') },
  { id: 'burger', text: 'Yan arsaya burger dükkanını aç', target: 1, progress: (d) => (d.burger ? 1 : 0) },
  { id: 'manager', text: 'Bir dükkana müdür al', target: 1, progress: (d) => managers(d) },
  { id: 'serve1000', text: '1.000 müşteriye servis yap', target: 1000, progress: (d) => stats(d).served },
  { id: 'trade', text: 'Bankadaki borsadan hisse al', target: 1, progress: (d) => stats(d).trades },
  { id: 'menu', text: 'Burger dükkanına menü tezgahı kur', target: 1, progress: (d) => has(d.burger, 'menu') },
  { id: 'burgerDone', text: 'Burger dükkanını %100 tamamla', target: SHOPS.burger.unlocks.length, progress: (d) => shopDone(d.burger, 'burger') },
  { id: 'market', text: 'Yan sokaktaki süpermarketi aç', target: 1, progress: (d) => (d.market ? 1 : 0) },
  { id: 'marketDone', text: 'Süpermarketi %100 tamamla', target: MARKET_UNLOCKS.length, progress: (d) => MARKET_UNLOCKS.filter((u) => d.market?.unlocked.includes(u.id)).length },
  { id: 'earn10m', text: `Toplam ${fmtMoney(10_000_000)} satış yap`, target: 10_000_000, progress: (d) => stats(d).earned },
  { id: 'hotel', text: 'Bahçedeki 5 yıldızlı oteli aç', target: 1, progress: (d) => (d.hotel ? 1 : 0) },
  { id: 'ipo', text: 'Bir şirketini borsada halka arz et', target: 1, progress: (d) => (Object.values(d.exchange?.float ?? {}).some((n) => (n ?? 0) > 0) ? 1 : 0) },
  { id: 'floor2', text: 'Otelin üst katını aç', target: 1, progress: (d) => has(d.hotel, UPPER_FLOOR.id) },
  { id: 'hotelDone', text: 'Oteli %100 tamamla', target: hotelIds.length, progress: (d) => hotelIds.filter((id) => d.hotel?.unlocked.includes(id)).length },
  { id: 'managers4', text: 'Dört işletmenin hepsine müdür al', target: 4, progress: (d) => managers(d) },
  // The mall, after the hotel.
  { id: 'mall', text: 'Otelin yanındaki arsaya AVM kur', target: 1, progress: (d) => (d.mall ? 1 : 0) },
  { id: 'mallRent', text: 'AVM yönetim ofisindeki kasadan ilk kirayı topla', target: 1, progress: (d) => ((d.mall?.collected ?? 0) > 0 ? 1 : 0) },
  { id: 'mallShops', text: 'AVM\'de 6 mağaza aç', target: 6, progress: (d) => MALL_UNITS.filter((u) => d.mall?.unlocked.includes(u.id)).length },
  { id: 'mallFloor1', text: 'AVM\'nin 1. katını aç', target: 1, progress: (d) => has(d.mall, 'mfloor1') },
  { id: 'mallFloor2', text: 'AVM\'nin 2. katını aç: yemek katı ve sinema', target: 1, progress: (d) => has(d.mall, 'mfloor2') },
  { id: 'mallSeans', text: 'Sinemaksimum\'da ilk seansı başlat', target: 1, progress: (d) => Math.min(1, d.mall?.seanses ?? 0) },
  { id: 'mallDone', text: 'AVM\'yi %100 tamamla', target: MALL_UNITS.length + MALL_FLOORS.length, progress: (d) => [...MALL_UNITS, ...MALL_FLOORS].filter((u) => d.mall?.unlocked.includes(u.id)).length },
  // The west end: the car gallery, a car of your own, property.
  { id: 'gallery', text: 'Caddenin batısında Oto Galeri kur', target: 1, progress: (d) => (d.gallery ? 1 : 0) },
  { id: 'car', text: 'Galerinin garajından kendine araba al', target: 1, progress: (d) => (d.garage?.owned.length ? 1 : 0) },
  { id: 'carsSold', text: 'Galeride 10 araba sat', target: 10, progress: (d) => d.gallery?.sold ?? 0 },
  { id: 'house', text: 'Bir ev ya da apartman satın al', target: 1, progress: (d) => PROPERTIES.filter((p) => p.kind !== 'shop' && d.estate?.props[p.id]).length },
  { id: 'rentOut', text: 'Aldığın bir evi kiraya ver', target: 1, progress: (d) => (Object.values(d.estate?.props ?? {}).some((p) => p.rented) ? 1 : 0) },
  { id: 'streetShops', text: 'Karşıdaki dört dükkanın hepsini satın al', target: 4, progress: (d) => PROPERTIES.filter((p) => p.kind === 'shop' && d.estate?.props[p.id]).length },
  { id: 'estateManager', text: 'Emlak ofisinden emlak yöneticisi tut', target: 1, progress: (d) => (d.estate?.manager ? 1 : 0) },
];

/** After the list, the street keeps going: each goal doubles the lifetime takings. */
const ENDLESS_START = 50_000_000;

export function goalAt(i: number): GoalDef {
  if (i < GOALS.length) return GOALS[i];
  const target = ENDLESS_START * 2 ** (i - GOALS.length);
  return {
    id: `earn${i}`,
    text: `Toplam ${fmtMoney(target)} satış yap`,
    target,
    progress: (d) => stats(d).earned,
  };
}
