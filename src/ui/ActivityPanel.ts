import { CAR_MODELS } from '../config/cars';
import type { Activity, BusinessDef } from '../config/city';
import { ESTATE_MANAGER_COST, PROPERTIES, property, RENOVATE, type PropertyDef } from '../config/estate';
import type { Game } from '../Game';
import { fmtMoney } from './Hud';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function effectText(a: Activity) {
  const e = TR.city.effect;
  if (a.buff === 'carry') return e.carry(a.amount, a.minutes);
  return e[a.buff](Math.round(a.amount * 100), a.minutes);
}

/** What the panel is showing: a business across the street, a house or block of flats, the estate office, or the garage. */
export interface PanelTarget {
  biz?: BusinessDef;
  prop?: PropertyDef;
  office?: boolean;
  garage?: boolean;
}

const row = (title: string, text: string, button: string) => `<li class="upg">
  <div class="upg-info"><h3>${title}</h3><p>${text}</p></div>${button}</li>`;
const btn = (kind: string, id: string, label: string, disabled: boolean, small = '') =>
  `<button class="buy" data-kind="${kind}" data-id="${id}" ${disabled ? 'disabled' : ''}>${label}${small ? `<small>${small}</small>` : ''}</button>`;

/** Bottom sheet for doors on the street: what you can do inside, and what you can own. */
export class ActivityPanel {
  private wrap = $('activity-panel');
  private list = $('activity-list');
  private t: PanelTarget | null = null;
  private refreshT = 0;

  constructor(private g: Game) {
    $('activity-close').addEventListener('click', () => this.close());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-kind]');
      if (!b || !this.t) return;
      const id = b.dataset.id!;
      const est = this.g.estate;
      const prop = property(id);
      switch (b.dataset.kind) {
        case 'act': {
          const act = this.t.biz?.activities.find((a) => a.id === id);
          if (this.t.biz && act) this.g.startActivity(this.t.biz, act);
          break;
        }
        case 'buy': if (prop) est.buy(prop); break;
        case 'rent': if (prop) est.rentOut(prop); break;
        case 'renovate': if (prop) est.renovate(prop); break;
        case 'collect': if (prop) est.collect(prop); break;
        case 'manager': est.hireManager(); break;
        case 'car-buy': this.g.buyCar(id); break;
        case 'car-use': this.g.useCar(id); break;
      }
      this.render();
    });
  }

  get isOpen() { return !this.wrap.hidden; }

  open(t: PanelTarget) {
    this.t = t;
    const prop = t.prop ?? (t.biz ? property(t.biz.id) : undefined);
    this.t.prop = prop;
    $('activity-title').textContent = t.garage ? TR.car.title
      : t.office ? TR.estate.office
      : t.biz ? TR.city.name[t.biz.id as keyof typeof TR.city.name] ?? '' : prop?.name ?? '';
    $('activity-sub').textContent = t.garage ? TR.car.sub
      : t.office ? TR.estate.officeSub
      : t.biz ? TR.city.about[t.biz.id] ?? '' : prop ? TR.estate.kind[prop.kind] : '';
    this.render();
    this.wrap.hidden = false;
  }

  close() {
    this.wrap.hidden = true;
    this.t = null;
  }

  update(dt: number) {
    if (!this.isOpen) return;
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.25;
    this.render();
  }

  render() {
    const t = this.t;
    if (!t) return;
    const money = this.g.money;
    const parts: string[] = [];
    if (t.garage) parts.push(this.garageRows(money));
    if (t.office) parts.push(this.officeRows(money));
    if (t.biz) {
      const mine = this.g.estate.owns(t.biz.id);
      parts.push(t.biz.activities.map((a) => row(TR.city.activity[a.id], effectText(a),
        btn('act', a.id, mine ? TR.estate.free : fmtMoney(a.price), !mine && money < a.price, TR.city.duration(a.secs)))).join(''));
    }
    if (t.prop) parts.push(this.propertyRows(t.prop, money));
    const html = parts.join('');
    if (html !== this.list.innerHTML) this.list.innerHTML = html;
  }

  private propertyRows(d: PropertyDef, money: number) {
    const est = this.g.estate;
    const st = est.st(d.id);
    const section = `<li class="upg section">${TR.estate.kind[d.kind]}</li>`;
    if (!st) {
      const pitch = d.kind === 'shop' ? TR.estate.shopFor(fmtMoney(d.rent)) : TR.estate.rentFor(fmtMoney(d.rent));
      return section + row(TR.estate.price(fmtMoney(d.price)), pitch, btn('buy', d.id, TR.estate.buy, money < d.price, fmtMoney(d.price)));
    }
    const rows: string[] = [];
    if (d.kind !== 'shop' && !st.rented) rows.push(row(TR.estate.rent, TR.estate.rentDesc, btn('rent', d.id, TR.estate.rent, false)));
    else rows.push(row(TR.estate.yours, TR.estate.earning(fmtMoney(est.rate(d)), fmtMoney(st.due)), btn('collect', d.id, TR.estate.collect, st.due < 1)));
    const maxed = st.level >= RENOVATE.max;
    const cost = est.renovateCost(d);
    rows.push(row(maxed ? TR.estate.maxed : TR.estate.renovate(st.level + 1), TR.estate.renovateDesc(Math.round(RENOVATE.step * 100)),
      btn('renovate', d.id, maxed ? TR.max : fmtMoney(cost), maxed || money < cost)));
    return section + rows.join('');
  }

  private officeRows(money: number) {
    const est = this.g.estate;
    const owned = PROPERTIES.filter((d) => est.owns(d.id));
    const rows = [row(TR.estate.manager, TR.estate.managerDesc,
      est.hasManager ? btn('manager', 'm', TR.estate.hired, true) : btn('manager', 'm', fmtMoney(ESTATE_MANAGER_COST), money < ESTATE_MANAGER_COST))];
    rows.push(`<li class="upg section">${TR.estate.summary(owned.length, PROPERTIES.length, fmtMoney(est.totalRate))}</li>`);
    if (!owned.length) rows.push(row('', TR.estate.none, ''));
    for (const d of owned) {
      const st = est.st(d.id)!;
      const text = d.kind !== 'shop' && !st.rented ? TR.estate.empty : TR.estate.earning(fmtMoney(est.rate(d)), fmtMoney(st.due));
      rows.push(row(d.name, text, ''));
    }
    return rows.join('');
  }

  private garageRows(money: number) {
    const gar = this.g.data.garage;
    return CAR_MODELS.map((c) => {
      const has = !!gar?.owned.includes(c.id);
      const using = gar?.active === c.id;
      const b = !has ? btn('car-buy', c.id, TR.car.buy, money < c.price, fmtMoney(c.price))
        : btn('car-use', c.id, using ? TR.car.using : TR.car.use, using);
      return row(c.name, TR.car.speed(Math.round(c.speed * 3.6)), b);
    }).join('');
  }
}
