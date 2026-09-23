import './style.css';
import { CloudSave } from './core/CloudSave';
import { loadSave, onSave } from './core/Save';
import { Game } from './Game';

async function boot() {
  // Canvas-drawn signs and tiles need the web fonts ready before first paint.
  const fonts = Promise.all([
    document.fonts.load('800 48px "Baloo 2"'),
    document.fonts.load('700 48px "Baloo 2"'),
    document.fonts.load('700 16px "Nunito"'),
  ]);
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]);
  // Inside claude.ai the save follows the account across devices; elsewhere it stays local.
  const cloud = await CloudSave.connect();
  let save = cloud ? await cloud.resolve(loadSave()) : undefined;
  // Dev server only: pick up a hand-corrected save once, if one is waiting.
  if (import.meta.env.DEV) {
    const res = await fetch('/__save-override').catch(() => null);
    if (res?.status === 200) save = { ...loadSave(), ...(await res.json()) };
  }
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, save);
  game.start();
  // Dev server only: hand the local save to the dev server so it can seed the published version.
  if (import.meta.env.DEV) {
    const post = (d: unknown) => void fetch('/__save', { method: 'POST', body: JSON.stringify(d) }).catch(() => {});
    post(game.data);
    onSave(post);
  }
  (window as unknown as { game: Game }).game = game;
}

void boot();
