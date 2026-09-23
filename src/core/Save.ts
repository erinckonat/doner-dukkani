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

let blocked = false;

export function writeSave(data: SaveData) {
  if (blocked) return;
  data.t = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress lives only in this session (and the cloud, if connected) */
  }
  for (const fn of listeners) fn(data);
}

const CODE_PREFIX = 'DD1-';

/** A copyable text form of the save, for moving the game to another device. */
export function encodeSave(data: SaveData) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return CODE_PREFIX + btoa(bin);
}

/** Null when the text isn't a save code (typo, partial paste). */
export function decodeSave(code: string): SaveData | null {
  const text = code.replace(/\s+/g, '');
  if (!text.startsWith(CODE_PREFIX)) return null;
  try {
    const bin = atob(text.slice(CODE_PREFIX.length));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    if (typeof data?.money !== 'number' || !Array.isArray(data.unlocked)) return null;
    return { ...freshSave(), v: 1, ...data };
  } catch {
    return null;
  }
}

/**
 * Make `data` this device's game and stop further saves, so the page can reload
 * into it without the running game writing its old state back on the way out.
 */
export function replaceSave(data: SaveData) {
  data.t = Date.now();
  data.synced = true; // newer than any cloud copy: the cloud takes this one
  localStorage.setItem(KEY, JSON.stringify(data));
  blocked = true;
}
