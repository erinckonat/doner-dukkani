import { HIRES, HR_UPGRADES, OFFICE_UPGRADES, UPGRADES, upgradeCost, type HireDef, type HireId, type UpgradeId } from '../config/balance';
import type { Game } from '../Game';
import type { DeskKind } from '../stations/Props';
import { fmtMoney } from './Hud';
import { TR } from './strings.tr';

/** Bottom sheet for both desks: Yönetim (player upgrades) and İK (hiring + staff upgrades). */
export class UpgradePanel {
  private wrap = document.getElementById('panel')!;
  private list = document.getElementById('upg-list')!;
  private title = document.getElementById('panel-title')!;
  private sub = document.getElementById('panel-sub')!;
  private refreshT = 0;
  private kind: DeskKind = 'office';
  isOpen = false;

  constructor(private g: Game) {
    document.getElementById('panel-close')!.addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!btn) return;
      if (btn.dataset.kind === 'hire') this.g.hire(btn.dataset.id as HireId);
      else this.g.buyUpgrade(btn.dataset.id as UpgradeId);
    });
  }

  open(kind: DeskKind) {
    if (this.isOpen && this.kind === kind) return;
    this.kind = kind;
    this.isOpen = true;
    this.title.textContent = kind === 'office' ? TR.panelTitle : TR.hrTitle;
    this.sub.textContent = kind === 'office' ? TR.panelSub : TR.hrSub;
    this.render();
    this.wrap.hidden = false;
  }

  close() {
    this.isOpen = false;
    this.wrap.hidden = true;
  }

  update(dt: number) {
    if (!this.isOpen) return;
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.25;
    this.render();
  }

  private pips(n: number, max: number, label: string) {
    const dots = Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    return `<div class="pips" aria-label="${label}">${dots}</div>`;
  }

  private valueText(id: UpgradeId, lvl: number) {
    const v = this.g.upgradeValue(id, lvl);
    if (id === 'price') return fmtMoney(v);
    return `${Number.isInteger(v) ? v : v.toFixed(1)} ${TR.upgrade[id].unit}`;
  }

  private upgradeRow(id: UpgradeId) {
    const d = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.g.lvl(id);
    const maxed = lvl >= d.max;
    const cost = upgradeCost(d, lvl);
    const next = maxed ? '' : ` → <b>${this.valueText(id, lvl + 1)}</b>`;
    return `<li class="upg">
      <div class="upg-info">
        <h3>${TR.upgrade[id].name}</h3>
        <p>${this.valueText(id, lvl)}${next}</p>
        ${this.pips(lvl, d.max, `Seviye ${lvl}/${d.max}`)}
      </div>
      <button class="buy" data-kind="upgrade" data-id="${id}" ${maxed || this.g.money < cost ? 'disabled' : ''}>${maxed ? TR.max : fmtMoney(cost)}</button>
    </li>`;
  }

  private hireRow(h: HireDef) {
    const n = this.g.hireCount(h.id);
    const max = h.costs.length;
    const locked = !!h.requires && !this.g.data.unlocked.includes(h.requires);
    const full = n >= max;
    const cost = h.costs[n];
    const label = locked ? TR.needsWindow : full ? TR.hired : `${TR.hireBtn}<small>${fmtMoney(cost)}</small>`;
    const disabled = locked || full || this.g.money < cost;
    return `<li class="upg hire">
      <div class="upg-info">
        <h3>${TR.hire[h.id].name} <span class="count">${TR.staffCount(n, max)}</span></h3>
        <p>${TR.hire[h.id].desc}</p>
        ${this.pips(n, max, TR.staffCount(n, max))}
      </div>
      <button class="buy ${locked ? 'locked' : ''}" data-kind="hire" data-id="${h.id}" ${disabled ? 'disabled' : ''}>${label}</button>
    </li>`;
  }

  render() {
    const html = this.kind === 'office'
      ? OFFICE_UPGRADES.map((id) => this.upgradeRow(id)).join('')
      : HIRES.map((h) => this.hireRow(h)).join('')
        + `<li class="section">${TR.staffSection}</li>`
        + HR_UPGRADES.map((id) => this.upgradeRow(id)).join('');
    if (html === this.list.innerHTML) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
    this.list.innerHTML = html;
    if (focused) this.list.querySelector<HTMLButtonElement>(`button[data-id="${focused}"]`)?.focus();
  }
}
