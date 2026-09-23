import { freshSave, onSave, type SaveData } from './Save';

/** Where a remote copy of the save lives: the claude.ai artifact database, or our own server. */
export interface SaveBackend {
  read(): Promise<SaveData | null>;
  /** Resolves false when the store refused because it holds a newer game. */
  write(data: SaveData, knownT: number): Promise<boolean>;
}

const PUSH_EVERY_MS = 8000;
/** Set just before reloading to adopt a newer game written by another device. */
const PREFER_REMOTE = 'doner-prefer-cloud';

/**
 * Keeps the local save and a remote copy in step, so the same game continues on
 * every device signed in to the same account.
 */
export class SaveSync {
  private lastPushed = '';
  private lastPushAt = 0;
  private pending: SaveData | null = null;
  private writing = false;
  private timer = 0;
  /** `t` of the remote copy as this page last read or wrote it. */
  private knownT = 0;
  private stopped = false;

  constructor(private backend: SaveBackend) {}

  /**
   * Pick which save to start from. A copy that has never synced (a new device)
   * takes the remote progress; otherwise the most recently played copy wins.
   */
  async resolve(local: SaveData): Promise<SaveData> {
    let chosen = local;
    try {
      const remote = await this.backend.read();
      this.knownT = remote?.t ?? 0;
      let preferRemote = false;
      try {
        preferRemote = sessionStorage.getItem(PREFER_REMOTE) === '1';
        sessionStorage.removeItem(PREFER_REMOTE);
      } catch { /* no session storage */ }
      if (remote && (preferRemote || !local.synced || (remote.t ?? 0) > (local.t ?? 0))) {
        chosen = { ...freshSave(), ...remote };
      }
    } catch {
      /* remote unreachable: keep playing locally, pushes retry later */
    }
    chosen.synced = true;
    onSave((d) => this.queue(d));
    addEventListener('pagehide', () => void this.flush());
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.flush(); });
    this.queue(chosen);
    return chosen;
  }

  private queue(data: SaveData) {
    this.pending = data;
    const wait = Math.max(0, this.lastPushAt + PUSH_EVERY_MS - Date.now());
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), wait);
  }

  /** Stop and reload into the newer game another device saved. */
  private adoptRemote() {
    this.stopped = true;
    try { sessionStorage.setItem(PREFER_REMOTE, '1'); } catch { /* reload still prefers the newer copy */ }
    location.reload();
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
      const remoteT = (await this.backend.read())?.t ?? 0;
      if (remoteT > this.knownT) return this.adoptRemote();
      const data = JSON.parse(body) as SaveData;
      if (!(await this.backend.write(data, this.knownT))) return this.adoptRemote();
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

// ---------- claude.ai artifact database ----------

// Minimal typing for the claude.ai artifact runtime; absent everywhere else.
interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface ClaudeRuntime {
  use(name: 'db'): Promise<{ doc(path: string): DocRef } | null>;
  use(name: 'user'): Promise<{ id(): Promise<string | null> } | null>;
}

const CONNECT_TIMEOUT_MS = 5000;

/** The viewer's private save document when running as a claude.ai artifact; null elsewhere. */
export async function claudeBackend(): Promise<SaveBackend | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return null;
  const attempt = (async (): Promise<SaveBackend | null> => {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    const uid = await user?.id();
    if (!db || !uid) return null;
    const ref = db.doc(`data/users/${uid}/save`);
    return {
      async read() {
        const snap = await ref.get();
        return snap.exists ? ((snap.data()?.save as SaveData | undefined) ?? null) : null;
      },
      async write(data) {
        await ref.set({ save: data });
        return true;
      },
    };
  })().catch(() => null);
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), CONNECT_TIMEOUT_MS));
  return Promise.race([attempt, timeout]);
}
