import { hireCost, hireMax, HR_UPGRADES, MACHINE_PRICE, OFFICE_UPGRADES, UPGRADES, upgradeCost, type HireDef, type HireId, type ProductKind, type ShopId, type UpgradeId } from '../config/balance';
import type { Game } from '../Game';
import type { Hotel } from '../Hotel';
import type { Market } from '../Market';
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
  /** The shop (or the market) whose desk the player is at. */
  private s: Shop | Market | Hotel | null = null;
  /** Hire row whose "Çıkar" was pressed once and now asks for confirmation. */
  private confirmFire: HireId | null = null;
  private confirmTimer = 0;
  isOpen = false;

  constructor(private g: Game) {
    document.getElementById('panel-close')!.addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!btn) return;
      if (!this.s) return;
      if (btn.dataset.kind === 'fire') return this.pressFire(btn.dataset.id as HireId);
      if (btn.dataset.kind === 'machine') (this.s as Shop).buyMachine(btn.dataset.id as ProductKind);
      else if (btn.dataset.kind === 'hire') this.s.hire(btn.dataset.id as HireId);
      else this.s.buyUpgrade(btn.dataset.id as UpgradeId);
    });
  }

  open(kind: DeskKind, shop: Shop | Market | Hotel) {
    if (this.isOpen && this.kind === kind && this.s === shop) return;
    this.kind = kind;
    this.s = shop;
    this.isOpen = true;
    this.title.textContent = kind === 'office' ? TR.panelTitle : TR.hrTitle;
    this.sub.textContent = kind === 'office' ? TR.panelSub : shop.id === 'market' ? TR.market.hrSub : shop.id === 'hotel' ? TR.hotel.hrSub : TR.hrSub;
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
        <h3>${id === 'price' ? TR.priceName[this.s!.id as ShopId] : TR.upgrade[id].name}</h3>
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
    const label = locked ? (h.requires === 'window' ? TR.needsWindow : TR.market.needsCheckout) : full ? TR.hired : `${TR.hireBtn}<small>${fmtMoney(cost)}</small>`;
    const disabled = locked || full || this.g.money < cost;
    return `<li class="upg hire">
      <div class="upg-info">
        <h3>${TR.hire[h.id].name} <span class="count">${open ? TR.staffCountOpen(n) : TR.staffCount(n, max)}</span></h3>
        <p>${TR.hire[h.id].desc}</p>
        ${open ? '' : this.pips(n, max, TR.staffCount(n, max))}
      </div>
      <div class="hire-actions">
        <button class="buy ${locked ? 'locked' : ''}" data-kind="hire" data-id="${h.id}" ${disabled ? 'disabled' : ''}>${label}</button>
        ${n ? `<button class="fire ${this.confirmFire === h.id ? 'armed' : ''}" data-kind="fire" data-id="${h.id}">${this.confirmFire === h.id ? TR.fireConfirm : TR.fireBtn}</button>` : ''}
      </div>
    </li>`;
  }

  /** First press arms it, the second (within 3 s) lets the worker go. */
  private pressFire(id: HireId) {
    clearTimeout(this.confirmTimer);
    if (this.confirmFire === id) {
      this.confirmFire = null;
      this.s?.fire(id);
      return;
    }
    this.confirmFire = id;
    this.render();
    this.confirmTimer = window.setTimeout(() => { this.confirmFire = null; this.render(); }, 3000);
  }

  private machineRows(s: Shop) {
    const total = s.producers.length + s.freeMachineSlots().length;
    const full = s.freeMachineSlots().length === 0;
    const rows = s.machineProducts().map((kind) => {
      const cost = MACHINE_PRICE[kind];
      const have = s.producers.filter((p) => p.product === kind).length;
      return `<li class="upg">
        <div class="upg-info">
          <h3>${TR.addMachine(TR.machine[kind])} <span class="count">${TR.machineCount(have)}</span></h3>
          <p>${TR.machineDesc}</p>
        </div>
        <button class="buy" data-kind="machine" data-id="${kind}" ${full || this.g.money < cost ? 'disabled' : ''}>${full ? TR.noRoom : fmtMoney(cost)}</button>
      </li>`;
    }).join('');
    return `<li class="section">${TR.kitchenSection(s.producers.length, total)}</li>${rows}`;
  }

  render() {
    if (!this.s) return;
    const html = this.kind === 'office'
      ? OFFICE_UPGRADES.map((id) => this.upgradeRow(id)).join('') + this.machineRows(this.s as Shop)
      : this.s.def.hires.map((h) => this.hireRow(h)).join('')
        + `<li class="section">${TR.staffSection}</li>`
        + HR_UPGRADES.map((id) => this.upgradeRow(id)).join('');
    if (html === this.list.innerHTML) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
    this.list.innerHTML = html;
    if (focused) this.list.querySelector<HTMLButtonElement>(`button[data-id="${focused}"]`)?.focus();
  }
}
