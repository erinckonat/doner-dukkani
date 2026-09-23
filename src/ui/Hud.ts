import { TR } from './strings.tr';

export const fmtMoney = (v: number) => `₺${Math.floor(v).toLocaleString('tr-TR')}`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private money = $('money');
  private moneyVal = $('money-val');
  private progFill = $('prog-fill');
  private progLabel = $('prog-label');
  private hint = $('hint');
  private toastEl = $('toast');
  private soundBtn = $<HTMLButtonElement>('sound-btn');
  private last = -1;
  private pulseAt = 0;
  private toastTimer = 0;
  private hintText = '';

  constructor(sound: boolean, onToggleSound: () => boolean) {
    this.setSound(sound);
    this.soundBtn.addEventListener('click', () => this.setSound(onToggleSound()));
  }

  private setSound(on: boolean) {
    this.soundBtn.classList.toggle('muted', !on);
    this.soundBtn.setAttribute('aria-label', on ? TR.soundOn : TR.soundOff);
    this.soundBtn.setAttribute('aria-pressed', String(!on));
  }

  setMoney(m: number) {
    const v = Math.floor(m);
    if (v === this.last) return;
    const now = performance.now();
    if (v > this.last && this.last >= 0 && now - this.pulseAt > 140) {
      this.pulseAt = now;
      this.money.classList.remove('pulse');
      void this.money.offsetWidth;
      this.money.classList.add('pulse');
    }
    this.last = v;
    this.moneyVal.textContent = fmtMoney(v);
  }

  setProgress(done: number, total: number) {
    const p = total ? done / total : 1;
    this.progFill.style.transform = `scaleX(${p})`;
    this.progLabel.textContent = `${TR.shop} %${Math.round(p * 100)}`;
  }

  setHint(text: string | null) {
    const t = text ?? '';
    if (t === this.hintText) return;
    this.hintText = t;
    this.hint.textContent = t;
    this.hint.hidden = !t;
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }
}
