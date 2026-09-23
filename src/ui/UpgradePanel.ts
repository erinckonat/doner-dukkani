import { hireCost, hireMax, HR_UPGRADES, OFFICE_UPGRADES, UPGRADES, upgradeCost, type HireDef, type HireId, type UpgradeId } from '../config/balance';
import type { Game } from '../Game';
import type { Shop } from '../Shop';
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
  /** The shop whose desk the player is at. */
  private s: Shop | null = null;
  isOpen = false;

  constructor(private g: Game) {
    document.getElementById('panel-close')!.addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!btn) return;
      if (!this.s) return;
      if (btn.dataset.kind === 'hire') this.s.hire(btn.dataset.id as HireId);
      else this.s.buyUpgrade(btn.dataset.id as UpgradeId);
    });
  }

  open(kind: DeskKind, shop: Shop) {
    if (this.isOpen && this.kind === kind && this.s === shop) return;
    this.kind = kind;
    this.s = shop;
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
    const v = this.s!.upgradeValue(id, lvl);
    if (id === 'price') return fmtMoney(v);
    return `${Number.isInteger(v) ? v : v.toFixed(1)} ${TR.upgrade[id].unit}`;
  }

  private upgradeRow(id: UpgradeId) {
    const d = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.s!.lvl(id);
    const maxed = lvl >= d.max;
    const cost = upgradeCost(d, lvl);
    const next = maxed ? '' : ` → <b>${this.valueText(id, lvl + 1)}</b>`;
    return `<li class="upg">
      <div class="upg-info">
        <h3>${id === 'price' ? TR.priceName[this.s!.id] : TR.upgrade[id].name}</h3>
        <p>${this.valueText(id, lvl)}${next}</p>
        ${this.pips(lvl, d.max, `Seviye ${lvl}/${d.max}`)}
      </div>
      <button class="buy" data-kind="upgrade" data-id="${id}" ${maxed || this.g.money < cost ? 'disabled' : ''}>${maxed ? TR.max : fmtMoney(cost)}</button>
    </li>`;
  }

  private hireRow(h: HireDef) {
    const n = this.s!.hireCount(h.id);
    const max = hireMax(h);
    const open = max > h.costs.length; // no fixed team size: show the headcount, not pips
    const locked = !!h.requires && !this.s!.ss.unlocked.includes(h.requires);
    const full = n >= max;
    const cost = hireCost(h, n);
    const label = locked ? TR.needsWindow : full ? TR.hired : `${TR.hireBtn}<small>${fmtMoney(cost)}</small>`;
    const disabled = locked || full || this.g.money < cost;
    return `<li class="upg hire">
      <div class="upg-info">
        <h3>${TR.hire[h.id].name} <span class="count">${open ? TR.staffCountOpen(n) : TR.staffCount(n, max)}</span></h3>
        <p>${TR.hire[h.id].desc}</p>
        ${open ? '' : this.pips(n, max, TR.staffCount(n, max))}
      </div>
      <button class="buy ${locked ? 'locked' : ''}" data-kind="hire" data-id="${h.id}" ${disabled ? 'disabled' : ''}>${label}</button>
    </li>`;
  }

  render() {
    if (!this.s) return;
    const html = this.kind === 'office'
      ? OFFICE_UPGRADES.map((id) => this.upgradeRow(id)).join('')
      : this.s.def.hires.map((h) => this.hireRow(h)).join('')
        + `<li class="section">${TR.staffSection}</li>`
        + HR_UPGRADES.map((id) => this.upgradeRow(id)).join('');
    if (html === this.list.innerHTML) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
    this.list.innerHTML = html;
    if (focused) this.list.querySelector<HTMLButtonElement>(`button[data-id="${focused}"]`)?.focus();
  }
}
