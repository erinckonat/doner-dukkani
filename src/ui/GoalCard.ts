import type { Game } from '../Game';
import { goalAt } from '../systems/Goals';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** How many goals after the current one the panel lets the player peek at. */
const PEEK = 3;

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>';

/**
 * The current goal under the money: what to do next and how far along. A finished
 * goal moves on to the next by itself; tapping the card opens the list.
 */
export class GoalCard {
  private card = $<HTMLButtonElement>('goal');
  private label = $('goal-label');
  private count = $('goal-count');
  private text = $('goal-text');
  private fill = $('goal-fill');
  private wrap = $('goals-panel');
  private list = $('goals-list');
  private key = '';
  private t = 0;

  constructor(private g: Game) {
    this.card.addEventListener('click', () => this.toggle());
    $('goals-close').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    // Goals already met in an older save move on quietly.
    this.advance(false);
    this.render();
  }

  get isOpen() { return !this.wrap.hidden; }

  private get index() { return this.g.data.goal ?? 0; }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    this.advance(true);
    this.render();
  }

  /** Step past every goal that's done; celebrate the last one if asked. */
  private advance(announce: boolean) {
    let last = null;
    for (let goal = goalAt(this.index); goal.progress(this.g.data) >= goal.target; goal = goalAt(this.index)) {
      last = goal;
      this.g.data.goal = this.index + 1;
    }
    if (!last || !announce) return;
    this.g.hud.toast(TR.goals.done(last.text));
    this.g.sfx.play('unlock', 1, 0);
    this.g.celebrateAtPlayer();
    this.g.save();
  }

  private toggle() {
    if (this.isOpen) return this.close();
    this.g.closePanels();
    this.renderList();
    this.wrap.hidden = false;
  }

  close() { this.wrap.hidden = true; }

  private render() {
    const goal = goalAt(this.index);
    const cur = Math.min(goal.target, goal.progress(this.g.data));
    const key = `${this.index}|${cur}`;
    if (key === this.key) return;
    this.key = key;
    this.label.textContent = TR.goals.label(this.index + 1);
    this.count.textContent = goal.target > 1 ? `${short(cur)}/${short(goal.target)}` : '';
    this.text.textContent = goal.text;
    this.fill.style.transform = `scaleX(${cur / goal.target})`;
    this.card.setAttribute('aria-label', `${goal.text}. ${TR.goals.open}`);
    if (this.isOpen) this.renderList();
  }

  private renderList() {
    const i = this.index;
    const row = (n: number, state: 'now' | 'next') => {
      const goal = goalAt(n);
      const cur = Math.min(goal.target, goal.progress(this.g.data));
      const note = state === 'now' && goal.target > 1 ? `<p>${short(cur)}/${short(goal.target)}</p>` : '';
      return `<li class="upg goal-row ${state}">
        <span class="goal-num">${n + 1}</span>
        <div class="upg-info"><h3>${goal.text}</h3>${note}</div>
      </li>`;
    };
    const html = [
      i ? `<li class="goal-done">${CHECK}${TR.goals.doneCount(i)}</li>` : '',
      row(i, 'now'),
      `<li class="upg section">${TR.goals.next}</li>`,
      ...Array.from({ length: PEEK }, (_, k) => row(i + 1 + k, 'next')),
    ].join('');
    if (html !== this.list.innerHTML) this.list.innerHTML = html;
  }
}

/** 1.250 / 12,5 B / 3 Mn: short enough for the small card. */
function short(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} Mn`;
  if (n >= 1e4) return `${(n / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} B`;
  return Math.floor(n).toLocaleString('tr-TR');
}
