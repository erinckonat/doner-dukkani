import type { EventId, Events } from '../systems/Events';
import { TR } from './strings.tr';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** One outline icon per event, drawn in the same 24px stroke style as the HUD buttons. */
const ICONS: Record<EventId, string> = {
  // A crowd: three heads and shoulders.
  rush: '<circle cx="12" cy="7" r="3"/><path d="M6.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="4.5" cy="9.5" r="2"/><path d="M1.5 19a3.5 3.5 0 0 1 4-3.4"/><circle cx="19.5" cy="9.5" r="2"/><path d="M22.5 19a3.5 3.5 0 0 0-4-3.4"/>',
  // A football.
  match: '<circle cx="12" cy="12" r="9"/><path d="m12 7.5 4 2.9-1.5 4.7h-5L8 10.4z"/><path d="M12 3v4.5M16 10.4l4.3-1.4M14.5 15.1l2.6 3.7M9.5 15.1l-2.6 3.7M8 10.4 3.7 9"/>',
  // A cloud with rain.
  rain: '<path d="M7 15a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 6.5a4.25 4.25 0 0 1 .5 8.5z"/><path d="m8 18-1 3M12.5 18l-1 3M17 18l-1 3"/>',
  // Banknotes.
  payday: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
  // A star.
  vip: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
  // A clipboard with a tick.
  inspection: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4M8.5 13l2.5 2.5 4.5-5"/>',
};

/** The event under the progress bar: what's going on, and how long it lasts. */
export class EventBanner {
  private el = $('event');
  private icon = $('event-icon');
  private name = $('event-name');
  private note = $('event-note');
  private time = $('event-time');
  private shown: EventId | null = null;
  private key = '';

  update(ev: Events) {
    const cur = ev.cur;
    if (!cur) {
      if (this.shown) {
        this.el.hidden = true;
        this.shown = null;
        this.key = '';
      }
      return;
    }
    const t = TR.events[cur.id];
    if (this.shown !== cur.id) {
      this.shown = cur.id;
      this.icon.innerHTML = ICONS[cur.id];
      this.name.textContent = t.name;
      this.el.dataset.kind = cur.id;
      this.el.hidden = false;
    }
    const note = cur.id === 'inspection' ? TR.events.inspection.dirty(ev.dirtyTables()) : t.note;
    const left = TR.events.left(ev.left);
    const key = `${note}|${left}`;
    if (key === this.key) return;
    this.key = key;
    this.note.textContent = note;
    this.time.textContent = left;
    this.el.classList.toggle('warn', cur.id === 'inspection' && ev.dirtyTables() > 0);
  }
}
