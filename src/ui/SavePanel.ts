import { Account } from '../core/Account';
import { clearLocalSave, decodeSave, encodeSave, replaceSave, type SaveData } from '../core/Save';
import { guestMode } from './AuthScreen';
import type { Game } from '../Game';
import { fmtMoney } from './Hud';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Copy the save as a code, or load a code from another device. */
export class SavePanel {
  private wrap = $('save-panel');
  private code = $<HTMLTextAreaElement>('save-code');
  private input = $<HTMLTextAreaElement>('save-input');
  private msg = $('save-msg');
  private loadBtn = $<HTMLButtonElement>('save-load');
  private pending: SaveData | null = null;

  constructor(private g: Game) {
    $('save-btn').addEventListener('click', () => (this.wrap.hidden ? this.open() : this.close()));
    $('save-close').addEventListener('click', () => this.close());
    $('save-copy').addEventListener('click', () => this.copy());
    this.loadBtn.addEventListener('click', () => this.load());
    this.input.addEventListener('input', () => this.reset());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  open() {
    this.g.panel.close();
    this.g.goals.close();
    this.code.hidden = true;
    this.input.value = '';
    this.reset();
    this.wrap.hidden = false;
  }

  close() { this.wrap.hidden = true; }

  /**
   * Account line for the game server: null hides it (claude.ai, GitHub Pages),
   * '' is a guest on the server, otherwise the signed-in email.
   */
  setAccount(email: string | null) {
    const row = $('account-row');
    row.hidden = email === null;
    if (email === null) return;
    const action = $<HTMLButtonElement>('account-action');
    $('account-text').textContent = email ? TR.auth.signedIn(email) : TR.auth.guest;
    action.textContent = email ? TR.auth.signOut : TR.auth.signInCta;
    action.onclick = async () => {
      if (email) {
        await Account.signOut();
        clearLocalSave();
      } else {
        guestMode.set(false);
      }
      location.reload();
    };
  }

  private say(text: string) { this.msg.textContent = text; }

  private reset() {
    this.pending = null;
    this.loadBtn.textContent = TR.save.loadBtn;
    this.say('');
  }

  private copy() {
    const text = encodeSave(this.g.data);
    this.code.value = text;
    const fallback = () => {
      this.code.hidden = false;
      this.code.focus();
      this.code.select();
      this.say(TR.save.copyFallback);
    };
    try {
      navigator.clipboard.writeText(text).then(() => this.say(TR.save.copied), fallback);
    } catch {
      fallback();
    }
  }

  /** First press checks the code and asks to confirm; the second replaces the game. */
  private load() {
    if (this.pending) {
      try {
        replaceSave(this.pending);
      } catch {
        this.say(TR.save.noStorage);
        return;
      }
      location.reload();
      return;
    }
    const data = decodeSave(this.input.value);
    if (!data) {
      this.say(TR.save.invalid);
      return;
    }
    this.pending = data;
    this.say(TR.save.confirm(fmtMoney(data.money), data.unlocked.length));
    this.loadBtn.textContent = TR.save.confirmBtn;
  }
}
