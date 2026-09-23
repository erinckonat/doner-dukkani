import './style.css';
import { Account } from './core/Account';
import { loadSave, onSave } from './core/Save';
import { claudeBackend, SaveSync, type SaveBackend } from './core/SaveSync';
import { guestMode, showAuth } from './ui/AuthScreen';
import { Game } from './Game';

async function boot() {
  // Canvas-drawn signs and tiles need the web fonts ready before first paint.
  const fonts = Promise.all([
    document.fonts.load('800 48px "Baloo 2"'),
    document.fonts.load('700 48px "Baloo 2"'),
    document.fonts.load('700 16px "Nunito"'),
  ]);
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);
  // The save follows the player's account: the claude.ai one inside claude.ai, or an
  // email account when served by the game server. Elsewhere it stays on this device.
  let backend: SaveBackend | null = await claudeBackend();
  let account: string | null = null;
  if (!backend) {
    account = await Account.detect();
    if (account === '' && !guestMode.get()) {
      const r = await showAuth();
      if (r !== 'guest') account = r.email;
    }
    if (account) backend = Account.backend();
  }
  let save = backend ? await new SaveSync(backend).resolve(loadSave()) : undefined;
  // Dev server only: pick up a hand-corrected save once, if one is waiting.
  if (import.meta.env.DEV) {
    const res = await fetch('/__save-override').catch(() => null);
    if (res?.status === 200) save = { ...loadSave(), ...(await res.json()) };
  }
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, save);
  game.start();
  game.savePanel.setAccount(account);
  // Dev server only: hand the local save to the dev server so it can seed the published version.
  if (import.meta.env.DEV) {
    const post = (d: unknown) => void fetch('/__save', { method: 'POST', body: JSON.stringify(d) }).catch(() => {});
    post(game.data);
    onSave(post);
  }
  (window as unknown as { game: Game }).game = game;
}

void boot();
