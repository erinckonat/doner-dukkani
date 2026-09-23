import { freshSave, onSave, type SaveData } from './Save';

// Minimal typing for the claude.ai artifact runtime; absent everywhere else (e.g. localhost).
interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface Db { doc(path: string): DocRef }
interface ClaudeRuntime {
  use(name: 'db'): Promise<Db | null>;
  use(name: 'user'): Promise<{ id(): Promise<string | null> } | null>;
}

const PUSH_EVERY_MS = 8000;
const CONNECT_TIMEOUT_MS = 5000;
/** Set just before reloading to adopt a newer game written by another device. */
const PREFER_CLOUD = 'doner-prefer-cloud';

/**
 * Mirrors the save to the viewer's private subtree of the artifact database
 * (data/users/<id>/save), so the same game continues on every device signed in
 * to the same claude.ai account.
 */
export class CloudSave {
  private lastPushed = '';
  private lastPushAt = 0;
  private pending: SaveData | null = null;
  private writing = false;
  private timer = 0;
  /** `t` of the cloud copy as this page last read or wrote it. */
  private knownT = 0;
  private stopped = false;

  private constructor(private db: Db, private ref: DocRef) {}

  /** Resolves null when not running inside claude.ai (or no signed-in viewer). */
  static async connect(): Promise<CloudSave | null> {
    const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
    if (!claude?.use) return null;
    const attempt = (async () => {
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      const uid = await user?.id();
      if (!db || !uid) return null;
      return new CloudSave(db, db.doc(`data/users/${uid}/save`));
    })().catch(() => null);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), CONNECT_TIMEOUT_MS));
    return Promise.race([attempt, timeout]);
  }

  /**
   * Pick which save to start from. A copy that has never synced (a new device)
   * takes the cloud's progress; otherwise the most recently played copy wins.
   * With no cloud save yet, a seed save (progress carried over from the local
   * version of the game) is the starting point for a fresh copy.
   */
  async resolve(local: SaveData): Promise<SaveData> {
    let chosen = local;
    try {
      const snap = await this.ref.get();
      const cloud = snap.exists ? (snap.data()?.save as SaveData | undefined) : undefined;
      this.knownT = cloud?.t ?? 0;
      let preferCloud = false;
      try {
        preferCloud = sessionStorage.getItem(PREFER_CLOUD) === '1';
        sessionStorage.removeItem(PREFER_CLOUD);
      } catch { /* no session storage */ }
      if (cloud && (preferCloud || !local.synced || (cloud.t ?? 0) > (local.t ?? 0))) {
        chosen = { ...freshSave(), ...cloud };
      } else if (!cloud && !local.synced) {
        const seed = await this.db.doc('seed/save').get();
        const s = seed.exists ? (seed.data()?.save as SaveData | undefined) : undefined;
        if (s) chosen = { ...freshSave(), ...s };
      }
    } catch {
      /* cloud unreachable: keep playing locally, pushes retry later */
    }
    chosen.synced = true;
    onSave((d) => this.queue(d));
    addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
    this.queue(chosen);
    return chosen;
  }

  private queue(data: SaveData) {
    this.pending = data;
    const wait = Math.max(0, this.lastPushAt + PUSH_EVERY_MS - Date.now());
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), wait);
  }

  /**
   * One write at a time, and only when something changed. If another device
   * saved since this page last looked, switch to that game instead of
   * overwriting it.
   */
  private async flush() {
    if (!this.pending || this.writing || this.stopped) return;
    const body = JSON.stringify(this.pending);
    this.pending = null;
    if (body === this.lastPushed) return;
    this.writing = true;
    try {
      const snap = await this.ref.get();
      const cloudT = (snap.exists ? (snap.data()?.save as SaveData | undefined)?.t : 0) ?? 0;
      if (cloudT > this.knownT) {
        this.stopped = true;
        try { sessionStorage.setItem(PREFER_CLOUD, '1'); } catch { /* reload still prefers the newer copy */ }
        location.reload();
        return;
      }
      const data = JSON.parse(body) as SaveData;
      await this.ref.set({ save: data });
      this.knownT = data.t;
      this.lastPushed = body;
      this.lastPushAt = Date.now();
    } catch {
      this.pending ??= JSON.parse(body) as SaveData;
    } finally {
      this.writing = false;
    }
    if (this.pending) this.queue(this.pending);
  }
}
