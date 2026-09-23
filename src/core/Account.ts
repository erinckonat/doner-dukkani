import type { SaveData } from './Save';
import type { SaveBackend } from './SaveSync';

export type AuthError = 'bad_email' | 'bad_password' | 'exists' | 'wrong' | 'too_many' | 'network';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`api/${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (res.headers.get('content-type') ?? '').includes('application/json') ? await res.json() : null;
  return { res, json };
}

/** Player accounts on the game's own server (email + password). */
export const Account = {
  /**
   * Null when the page isn't served by the game server (claude.ai, GitHub Pages,
   * the dev server); otherwise the signed-in email, or '' when signed out.
   */
  async detect(): Promise<string | null> {
    try {
      const { json } = await call('GET', 'me');
      if (!json || typeof json.ok !== 'boolean') return null;
      return json.ok ? String(json.email) : '';
    } catch {
      return null;
    }
  },

  async signIn(mode: 'login' | 'register', email: string, password: string): Promise<{ email?: string; error?: AuthError }> {
    try {
      const { json } = await call('POST', mode, { email, password });
      if (json?.ok) return { email: json.email };
      return { error: (json?.error as AuthError) ?? 'network' };
    } catch {
      return { error: 'network' };
    }
  },

  async signOut() {
    await call('POST', 'logout').catch(() => {});
  },

  backend(): SaveBackend {
    return {
      async read() {
        const { res, json } = await call('GET', 'save');
        if (!res.ok || !json?.ok) throw new Error('save_read');
        return (json.save as SaveData | null) ?? null;
      },
      async write(data, knownT) {
        const { res } = await call('PUT', 'save', { save: data, knownT });
        if (res.status === 409) return false;
        if (!res.ok) throw new Error('save_write');
        return true;
      },
    };
  },
};
