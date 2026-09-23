import type { HireId, UpgradeId } from '../config/balance';

const KEY = 'doner-dukkani-save-v1';

export interface SaveData {
  /** 2 = lira prices (döner 200 TL). Older saves used prices 40× smaller. */
  v: number;
  money: number;
  unlocked: string[];
  paid: Record<string, number>;
  upg: Partial<Record<UpgradeId, number>>;
  hires: Partial<Record<HireId, number>>;
  tut: number;
  sound: boolean;
  t: number;
  /** This copy has been matched against the account's cloud save at least once. */
  synced?: boolean;
}

export const freshSave = (): SaveData => ({
  v: 2, money: 0, unlocked: [], paid: {}, upg: {}, hires: {}, tut: 0, sound: true, t: 0,
});

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    return { ...freshSave(), v: 1, ...JSON.parse(raw) };
  } catch {
    return freshSave();
  }
}

const listeners: ((data: SaveData) => void)[] = [];

/** Called after every save, e.g. to mirror it to the cloud. */
export function onSave(fn: (data: SaveData) => void) {
  listeners.push(fn);
}

export function writeSave(data: SaveData) {
  data.t = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress lives only in this session (and the cloud, if connected) */
  }
  for (const fn of listeners) fn(data);
}
