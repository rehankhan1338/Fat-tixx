import type { EventCard } from '@/api/types';

/** Formatting helpers ported from the website (src/lib/home/events.ts and src/lib/money.ts). */
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseStart(e: { date: string; time: string }): Date {
  const [y, m, d] = e.date.split('-').map(Number);
  const [h, mi] = e.time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
}

export function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM');
}

/** "Sat, Oct 10, 8 PM" */
export function whenText(d: Date): string {
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${clock(d)}`;
}

/** "$25" or "$29.62" */
export function money(p: number): string {
  return '$' + (Number.isInteger(p) ? String(p) : p.toFixed(2));
}

export function priceText(e: EventCard): string {
  return e.price == null ? 'Free' : 'From ' + money(e.price);
}

const SYMBOL: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', SEK: 'kr', AUD: 'A$' };

/** Integer cents → "$12.50". Intl currency formatting is not reliable on every Android locale, so this is explicit. */
export function formatCents(cents: number, currency = 'USD'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  const sym = SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  return `${sign}${sym}${whole}.${frac}`;
}

export function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export type ListedEvent = EventCard & { dt: Date; v: number };

/** Upcoming events, soonest first, with a rotating poster style so neighbours differ. */
export function listUpcoming(events: EventCard[]): ListedEvent[] {
  const today = startOfToday();
  const all = events.map((e) => ({ ...e, dt: parseStart(e), v: 0 }));
  let list = all.filter((e) => e.dt >= today);
  if (!list.length) list = all;
  list.sort((a, b) => a.dt.getTime() - b.dt.getTime());
  list.forEach((e, i) => (e.v = i % 6));
  return list;
}

export type WhenFilter = '' | 'weekend' | '7' | '30';

export function inWindow(e: ListedEvent, when: WhenFilter): boolean {
  if (!when) return true;
  const today = startOfToday();
  if (when === 'weekend') {
    const day = today.getDay();
    const back = ({ 5: 0, 6: 1, 0: 2 } as Record<number, number>)[day];
    const fri = new Date(today);
    fri.setDate(today.getDate() + (back === undefined ? 5 - day : -back));
    const mon = new Date(fri);
    mon.setDate(fri.getDate() + 3);
    return e.dt >= fri && e.dt < mon;
  }
  const end = new Date(today);
  end.setDate(today.getDate() + Number(when) + 1);
  return e.dt >= today && e.dt < end;
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/** mm:ss left until an ISO instant. */
export function countdown(iso: string | null): { ms: number; label: string } {
  if (!iso) return { ms: 0, label: '0:00' };
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return { ms, label: `${m}:${String(s).padStart(2, '0')}` };
}
