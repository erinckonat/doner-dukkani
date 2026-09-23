import type { Activity, BusinessDef } from '../config/city';
import type { Game } from '../Game';
import { fmtMoney } from './Hud';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function effectText(a: Activity) {
  const e = TR.city.effect;
  if (a.buff === 'carry') return e.carry(a.amount, a.minutes);
  return e[a.buff](Math.round(a.amount * 100), a.minutes);
}

/** What you can do inside a business on the high street. */
export class ActivityPanel {
  private wrap = $('activity-panel');
  private list = $('activity-list');
  private biz: BusinessDef | null = null;
  private refreshT = 0;

  constructor(private g: Game) {
    $('activity-close').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      const act = this.biz?.activities.find((a) => a.id === btn?.dataset.id);
      if (this.biz && act) this.g.startActivity(this.biz, act);
    });
  }

  get isOpen() { return !this.wrap.hidden; }

  open(biz: BusinessDef) {
    this.biz = biz;
    $('activity-title').textContent = TR.city.name[biz.id as keyof typeof TR.city.name] ?? '';
    $('activity-sub').textContent = TR.city.about[biz.id] ?? '';
    this.render();
    this.wrap.hidden = false;
  }

  close() {
    this.wrap.hidden = true;
    this.biz = null;
  }

  update(dt: number) {
    if (!this.isOpen) return;
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.25;
    this.render();
  }

  private render() {
    if (!this.biz) return;
    const html = this.biz.activities.map((a) => `<li class="upg">
      <div class="upg-info">
        <h3>${TR.city.activity[a.id]}</h3>
        <p>${effectText(a)}</p>
      </div>
      <button class="buy" data-id="${a.id}" ${this.g.money < a.price ? 'disabled' : ''}>${fmtMoney(a.price)}<small>${TR.city.duration(a.secs)}</small></button>
    </li>`).join('');
    if (html !== this.list.innerHTML) this.list.innerHTML = html;
  }
}
