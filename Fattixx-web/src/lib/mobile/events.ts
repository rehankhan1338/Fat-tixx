import 'server-only';
import { env } from '../env';
import { query, type Row } from '../db';
import { publicEvents } from '../home/data';
import {
  accessCodeMatches, addonAvailable, getPublicEventBySlug, listAddons, listEventDates, listQuestions, listSeriesSiblings, listTicketTypes, questionOptions, ticketTypeAvailable, ticketTypeOnSale,
  type PublicEventRow,
} from '../events/queries';
import { allInAddonCents, allInUnitCents, effectiveTaxBps, expireStaleHolds, feeConfigForEvent } from '../orders/checkout';
import { listMemberships } from '../authz';
import { refundPolicyText } from '../events/refund-policy';
import { processingLabel } from '../home/pricing';
import { formatEventDate } from '../tz';
import { uploadUrl } from '../uploads';
import { isAdmitted } from '../queue';
import { isSmsConfigured } from '../sms';
import { listVisibleSponsors } from '../sponsors';
import type { CurrentSession } from '../auth/session';

/**
 * Event data shaped for the mobile app. Mirrors what the public website shows (homepage list and
 * /events/[slug]) so both channels present the same events, prices and rules. Only real, published
 * events are returned; an empty list means there is nothing on sale.
 */

/** Uploaded images are served from the website; the app needs absolute URLs. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${env.APP_URL}${path}`;
}

export interface MobileEventCard {
  id: number;
  slug: string;
  key: string | null;          // private-link key when the event is private
  title: string;
  category: string;
  date: string;                // YYYY-MM-DD in the venue's zone
  time: string;                // HH:MM
  venue: string;
  city: string;
  lat: number | null;
  lon: number | null;
  price: number | null;        // lowest all-in price in dollars; null = free
  featured: boolean;
  tag: string | null;
  imageUrl: string | null;     // real photo
  poster: string;              // placeholder key when there is no photo
  organizerName: string;
  organizerInitials: string;
  organizerId: string;
}

function parseHref(href: string | undefined): { slug: string; key: string | null } | null {
  const m = href?.match(/^\/events\/([a-z0-9-]+)(?:\?key=([A-Za-z0-9_-]+))?$/);
  return m ? { slug: m[1], key: m[2] ?? null } : null;
}

export async function mobileEventList(): Promise<{ events: MobileEventCard[] }> {
  const real = await publicEvents();
  const events: MobileEventCard[] = [];
  for (const e of real) {
    const link = parseHref(e.href);
    if (!link) continue;
    const isUrl = !!e.image && /^(\/|https?:)/.test(e.image);
    events.push({
      id: e.id, slug: link.slug, key: link.key, title: e.title, category: e.category, date: e.date, time: e.time, venue: e.venue, city: e.city,
      lat: e.lat ?? null, lon: e.lon ?? null, price: e.price, featured: e.featured, tag: e.tag ?? null,
      imageUrl: isUrl ? absoluteUrl(e.image!) : null, poster: !isUrl && e.image ? e.image : 'gala',
      organizerName: e.organizerName, organizerInitials: e.organizerInitials, organizerId: e.organizerId,
    });
  }
  return { events };
}

export interface MobileTicketOption {
  id: number; name: string; description: string | null; kind: string; priceCents: number; allInCents: number; available: number;
  min: number; max: number; seats: number; onSale: boolean; reason: string | null; salesStart: string | null; presale: boolean; dayLabel: string | null;
}
export interface MobileAddonOption { id: number; name: string; description: string | null; priceCents: number; allInCents: number; available: number | null; max: number }
export interface MobileQuestion { id: number; label: string; kind: 'text' | 'textarea' | 'select' | 'checkbox'; required: boolean; options: string[] }

export interface MobileEventDetail {
  event: {
    id: number; slug: string; key: string | null; title: string; summary: string | null; description: string | null; imageUrl: string | null;
    startsAt: string; endsAt: string | null; doorsAt: string | null; timezone: string; status: string; visibility: string; currency: string; feeMode: string;
    ageRestriction: number | null; allowTransfers: boolean; refundText: string; category: string | null;
    venue: { name: string | null; address: string | null; city: string | null; region: string | null };
    organizer: { name: string; slug: string; logoUrl: string | null };
    dates: { id: number; label: string; when: string }[];
    siblings: { slug: string; key: string | null; when: string }[];
    sponsors: { id: number; name: string; logoUrl: string | null; url: string | null; tier: string | null }[];
  };
  isLive: boolean;
  preview: boolean;            // draft / unpublished, visible to the team only
  tickets: MobileTicketOption[];
  addons: MobileAddonOption[];
  questions: MobileQuestion[];
  soldOut: boolean;
  soldOutTypes: { id: number; name: string }[];
  showWaitlist: boolean;
  hasPresale: boolean;
  accessCode: string;          // the code that unlocked tickets, echoed back for checkout
  codeRejected: boolean;
  unlockedNames: string[];
  hasPromo: boolean;
  smsEnabled: boolean;
  inQueue: boolean;
  feeNote: string;
}

/**
 * Everything the event screen needs. Returns null when the event does not exist or the caller
 * may not see it (unpublished events are visible to the organizer's team only; private ones need their key).
 */
export async function mobileEventDetail(slug: string, opts: { accessCode?: string; linkKey?: string | null; session: CurrentSession | null }): Promise<MobileEventDetail | null> {
  const event = await getPublicEventBySlug(slug);
  if (!event) return null;
  await expireStaleHolds();
  const { session } = opts;
  const isTeam = !!session && (session.user.roles.length > 0 || (await listMemberships(session.user.id)).some((m) => m.organization_id === event.organization_id));
  const isLive = ['published', 'postponed'].includes(event.status);
  if (!isLive && !isTeam) return null;
  if (event.visibility === 'private' && !isTeam && (!event.private_key || opts.linkKey !== event.private_key)) return null;
  // Password-protected events are only shown on the website, where the visitor types the password.
  if (event.access_password && !isTeam) return null;

  const accessCode = (opts.accessCode ?? '').trim().slice(0, 40);
  const [types, fees, dates, addons, questions, siblings, sponsors, promos, admitted] = await Promise.all([
    listTicketTypes(event.id), feeConfigForEvent(event), listEventDates(event.id), listAddons(event.id), listQuestions(event.id),
    event.series_id ? listSeriesSiblings(event.series_id, event.id) : Promise.resolve([] as PublicEventRow[]),
    listVisibleSponsors(event.id),
    query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM promo_codes WHERE event_id = ? AND active = 1 AND (ends_at IS NULL OR ends_at > NOW())`, [event.id]),
    event.queue_enabled && !isTeam ? isAdmitted(event.id) : Promise.resolve(true),
  ]);
  const taxBps = effectiveTaxBps(event);
  const dayLabelFor = (id: number | null) => {
    if (!id) return null;
    const d = dates.find((x) => Number(x.id) === Number(id));
    return d ? d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false }) : null;
  };
  const unlocked = types.filter((t) => accessCodeMatches(t, accessCode));
  const visible = types.filter((t) => !t.hidden || unlocked.includes(t));
  const tickets: MobileTicketOption[] = visible.map((t) => {
    const sale = unlocked.includes(t) ? ticketTypeOnSale({ ...t, hidden: 0 }) : ticketTypeOnSale(t);
    return {
      id: Number(t.id), name: t.name, description: t.description, kind: t.kind, priceCents: Number(t.price_cents),
      allInCents: allInUnitCents(Number(t.price_cents), fees, taxBps, event.fee_mode), available: ticketTypeAvailable(t),
      min: Number(t.min_per_order), max: Number(t.max_per_order), seats: Number(t.seats_per_unit), onSale: sale.onSale, reason: sale.reason ?? null,
      salesStart: t.sales_start_at ? formatEventDate(new Date(t.sales_start_at), event.timezone) : null, presale: unlocked.includes(t), dayLabel: dayLabelFor(t.event_date_id),
    };
  });
  const addonOptions: MobileAddonOption[] = addons.filter((a) => a.active).map((a) => ({
    id: Number(a.id), name: a.name, description: a.description, priceCents: Number(a.price_cents),
    allInCents: allInAddonCents(Number(a.price_cents), fees, taxBps, event.fee_mode), available: addonAvailable(a), max: Number(a.max_per_order),
  }));
  const questionViews: MobileQuestion[] = questions.map((q) => ({ id: Number(q.id), label: q.label, kind: q.kind, required: !!q.required, options: questionOptions(q) }));
  const soldOut = tickets.length > 0 && tickets.every((o) => !o.onSale && o.reason === 'sold_out');
  const soldOutTypes = tickets.filter((o) => !o.onSale && o.reason === 'sold_out' && !o.presale).map((o) => ({ id: o.id, name: o.name }));
  const processing = processingLabel(fees);
  const feeNote = event.fee_mode === 'buyer_pays'
    ? `Prices include the ticket price, service fee${taxBps ? ' and tax' : ''}.${processing ? ` A card processing fee of ${processing} is added at checkout.` : ' No additional charges at checkout.'}`
    : `Prices include all fees${taxBps ? ' and tax' : ''}. No additional charges at checkout.`;
  const refundText = refundPolicyText(event);

  return {
    event: {
      id: Number(event.id), slug: event.slug, key: event.visibility === 'private' ? event.private_key : null, title: event.title, summary: event.summary, description: event.description,
      imageUrl: absoluteUrl(uploadUrl(event.image_path)), startsAt: new Date(event.starts_at).toISOString(), endsAt: event.ends_at ? new Date(event.ends_at).toISOString() : null,
      doorsAt: event.doors_at ? new Date(event.doors_at).toISOString() : null, timezone: event.timezone, status: event.status, visibility: event.visibility,
      currency: event.currency, feeMode: event.fee_mode, ageRestriction: event.age_restriction, allowTransfers: !!event.allow_transfers, refundText, category: event.category,
      venue: { name: event.venue_name, address: event.venue_address, city: event.venue_city, region: event.venue_region },
      organizer: { name: event.org_name, slug: event.org_slug, logoUrl: absoluteUrl(uploadUrl(event.org_logo)) },
      dates: dates.map((d) => ({ id: Number(d.id), label: d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false }), when: formatEventDate(new Date(d.starts_at), event.timezone) })),
      siblings: siblings.map((s) => ({ slug: s.slug, key: s.visibility === 'private' ? s.private_key : null, when: formatEventDate(new Date(s.starts_at), s.timezone) })),
      sponsors: sponsors.map((s) => ({ id: Number(s.id), name: s.name, logoUrl: absoluteUrl(s.logoUrl), url: s.url, tier: s.tier })),
    },
    isLive, preview: !isLive, tickets, addons: addonOptions, questions: questionViews, soldOut, soldOutTypes,
    showWaitlist: isLive && !!event.waitlist_enabled && soldOutTypes.length > 0,
    hasPresale: types.some((t) => t.hidden && t.access_code),
    accessCode: unlocked.length ? accessCode : '', codeRejected: accessCode !== '' && unlocked.length === 0, unlockedNames: unlocked.map((t) => t.name),
    hasPromo: Number(promos[0]?.n) > 0, smsEnabled: isSmsConfigured(), inQueue: isLive && !!event.queue_enabled && !admitted, feeNote,
  };
}
