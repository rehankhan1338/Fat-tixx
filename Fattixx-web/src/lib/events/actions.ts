'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent } from '../authz';
import { parseDollarsToCents } from '../money';
import { randomToken } from '../security/crypto';
import { getSettings } from '../settings';
import { slugify, shortSuffix } from '../slug';
import { isValidTimeZone, shiftWallClock, wallClockToUtc } from '../tz';
import { copyUpload, deleteUpload, saveImageUpload } from '../uploads';
import { getEvent, listEventDates, type EventRow } from './queries';
import { categoryNames } from '../site-content/categories';

/** Homepage listing fields: category (any organizer) and featured (Super Admin only; unchanged otherwise). */
async function saveListingFields(fd: FormData, eventId: number, isSuperAdmin: boolean): Promise<string | null> {
  const category = String(fd.get('category') ?? '').trim();
  if (category && !(await categoryNames()).includes(category)) return 'Choose a category from the list.';
  await execute(`UPDATE events SET category = ? WHERE id = ?`, [category || null, eventId]);
  if (isSuperAdmin && fd.has('featured_present')) await execute(`UPDATE events SET featured = ? WHERE id = ?`, [fd.get('featured') ? 1 : 0, eventId]);
  return null;
}

/** Optional venue map position for "events near you" on the homepage. */
function coords(fd: FormData): { lat: number | null; lon: number | null } | { error: string } {
  const la = String(fd.get('latitude') ?? '').trim(), lo = String(fd.get('longitude') ?? '').trim();
  if (!la && !lo) return { lat: null, lon: null };
  const lat = Number(la), lon = Number(lo);
  if (!la || !lo || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'Enter both latitude and longitude as decimal degrees (e.g. 34.8526 and -82.3940), or leave both empty.' };
  return { lat, lon };
}

export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;

const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const optInt = (fd: FormData, k: string, min = 0, max = 10_000_000): number | null => {
  const v = str(fd, k, 20); if (v === '') return null;
  const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

async function loadEventForEdit(orgSlug: string, eventId: number, minimum: 'organizer' | 'org_admin' = 'organizer') {
  const ctx = await assertOrg(orgSlug, minimum);
  const event = await getEvent(ctx.org.id, eventId);
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found');
  return { ctx, event };
}

function revalidateEvent(orgSlug: string, eventId?: number, eventSlug?: string) {
  revalidatePath(`/org/${orgSlug}/events`);
  if (eventId) revalidatePath(`/org/${orgSlug}/events/${eventId}`);
  if (eventSlug) revalidatePath(`/events/${eventSlug}`);
  revalidatePath('/');
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------
function venueFields(fd: FormData) {
  const name = str(fd, 'name', 160);
  const timezone = str(fd, 'timezone', 64) || 'America/New_York';
  const taxPct = Number(str(fd, 'tax_pct', 10) || '0');
  const capacity = optInt(fd, 'capacity', 0, 1_000_000);
  if (name.length < 2) return { error: 'Enter the venue name.' } as const;
  if (!isValidTimeZone(timezone)) return { error: 'Choose a valid time zone.' } as const;
  if (!Number.isFinite(taxPct) || taxPct < 0 || taxPct > 30) return { error: 'Tax must be between 0 and 30 percent.' } as const;
  if (Number.isNaN(capacity)) return { error: 'Capacity must be a whole number.' } as const;
  const city = str(fd, 'city', 120) || null, region = str(fd, 'region', 120) || null, taxBps = Math.round(taxPct * 100), taxLabel = str(fd, 'tax_label', 80) || null;
  return {
    values: [name, str(fd, 'address_line1', 200) || null, str(fd, 'address_line2', 200) || null, city, region,
      str(fd, 'postal_code', 20) || null, (str(fd, 'country', 2) || 'US').toUpperCase(), timezone, capacity, taxBps, taxLabel] as const,
    /** what the New event page needs to list the venue */
    summary: { name, city, region, timezone, taxBps, taxLabel },
  };
}

export type InlineVenue = { id: number; name: string; city: string | null; region: string | null; timezone: string; taxBps: number; taxLabel: string | null };
export type InlineVenueState = { error: string } | { ok: true; venue: InlineVenue } | undefined;

// explicit: an inferred union of object literals gets each other's keys as optional, which breaks the 'error' in v checks
type VenueInsert = { error: string } | { id: number; summary: Omit<InlineVenue, 'id'> };

async function insertVenue(fd: FormData): Promise<VenueInsert> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const f = venueFields(fd);
  if (f.error !== undefined) return { error: f.error };
  const pos = coords(fd);
  if ('error' in pos) return { error: pos.error };
  const r = await execute(
    `INSERT INTO venues (organization_id, name, address_line1, address_line2, city, region, postal_code, country, timezone, capacity, tax_bps, tax_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ctx.org.id, ...f.values],
  );
  await execute(`UPDATE venues SET latitude = ?, longitude = ? WHERE id = ?`, [pos.lat, pos.lon, r.insertId]);
  await audit('venue.created', { actorUserId: ctx.session.user.id, targetType: 'venue', targetId: r.insertId });
  revalidatePath(`/org/${ctx.org.slug}/venues`);
  return { id: r.insertId, summary: f.summary };
}

export async function createVenue(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const v = await insertVenue(fd);
  return 'error' in v ? { error: v.error } : { ok: true };
}

/** "Add venue" on the dashboard's New event page: saves the venue and returns it so the form can select it at once. */
export async function createVenueInline(_prev: InlineVenueState, fd: FormData): Promise<InlineVenueState> {
  const v = await insertVenue(fd);
  if ('error' in v) return { error: v.error };
  return { ok: true, venue: { id: v.id, ...v.summary } };
}

export async function updateVenue(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const id = Number(fd.get('venue_id'));
  const f = venueFields(fd);
  if ('error' in f) return { error: f.error };
  const pos = coords(fd);
  if ('error' in pos) return { error: pos.error };
  const r = await execute(
    `UPDATE venues SET name=?, address_line1=?, address_line2=?, city=?, region=?, postal_code=?, country=?, timezone=?, capacity=?, tax_bps=?, tax_label=? WHERE id = ? AND organization_id = ?`,
    [...f.values, id, ctx.org.id],
  );
  if (!r.affectedRows) return { error: 'Venue not found.' };
  await execute(`UPDATE venues SET latitude = ?, longitude = ? WHERE id = ? AND organization_id = ?`, [pos.lat, pos.lon, id, ctx.org.id]);
  await audit('venue.updated', { actorUserId: ctx.session.user.id, targetType: 'venue', targetId: id });
  revalidatePath(`/org/${ctx.org.slug}/venues`);
  return { ok: true };
}

export async function deleteVenue(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const id = Number(fd.get('venue_id'));
  const used = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE venue_id = ?`, [id]);
  if (Number(used?.n ?? 0) > 0) return { error: 'This venue is used by events. Change those events first.' };
  await execute(`DELETE FROM venues WHERE id = ? AND organization_id = ?`, [id, ctx.org.id]);
  await audit('venue.deleted', { actorUserId: ctx.session.user.id, targetType: 'venue', targetId: id });
  revalidatePath(`/org/${ctx.org.slug}/venues`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
async function eventFields(fd: FormData, orgId: number, existing?: EventRow) {
  const title = str(fd, 'title', 200);
  if (title.length < 3) return { error: 'Enter an event title (at least 3 characters).' } as const;
  const venueId = optInt(fd, 'venue_id', 1);
  let timezone = str(fd, 'timezone', 64);
  let venue: (Row & { id: number; timezone: string }) | null = null;
  if (venueId) {
    venue = await queryOne<Row & { id: number; timezone: string }>(`SELECT id, timezone FROM venues WHERE id = ? AND organization_id = ?`, [venueId, orgId]);
    if (!venue) return { error: 'Venue not found.' } as const;
    if (!timezone) timezone = venue.timezone;
  }
  if (!timezone) timezone = 'America/New_York';
  if (!isValidTimeZone(timezone)) return { error: 'Choose a valid time zone.' } as const;

  const startsAt = wallClockToUtc(str(fd, 'starts_at', 25), timezone);
  if (!startsAt) return { error: 'Enter the start date and time.' } as const;
  const endsRaw = str(fd, 'ends_at', 25); const doorsRaw = str(fd, 'doors_at', 25);
  const endsAt = endsRaw ? wallClockToUtc(endsRaw, timezone) : null;
  const doorsAt = doorsRaw ? wallClockToUtc(doorsRaw, timezone) : null;
  if (endsRaw && !endsAt) return { error: 'End time is invalid.' } as const;
  if (endsAt && endsAt <= startsAt) return { error: 'End time must be after the start time.' } as const;
  if (doorsAt && doorsAt > startsAt) return { error: 'Doors must open before the event starts.' } as const;

  const capacity = optInt(fd, 'capacity', 1, 1_000_000);
  if (Number.isNaN(capacity)) return { error: 'Capacity must be a whole number.' } as const;
  const age = optInt(fd, 'age_restriction', 0, 99);
  const visibility = str(fd, 'visibility', 10);
  if (!['public', 'private', 'unlisted'].includes(visibility)) return { error: 'Choose a visibility.' } as const;
  const feeMode = str(fd, 'fee_mode', 20);
  if (!['buyer_pays', 'organizer_absorbs'].includes(feeMode)) return { error: 'Choose who pays the fees.' } as const;
  const taxRaw = str(fd, 'tax_pct', 10);
  const taxBps = taxRaw === '' ? null : Math.round(Number(taxRaw) * 100);
  if (taxBps !== null && (!Number.isFinite(taxBps) || taxBps < 0 || taxBps > 3000)) return { error: 'Tax must be between 0 and 30 percent, or blank to use the venue rate.' } as const;
  const refundPolicy = str(fd, 'refund_policy', 20);
  if (!['no_refunds', 'until_event_start', 'days_before'].includes(refundPolicy)) return { error: 'Choose a refund policy.' } as const;
  const refundDays = refundPolicy === 'days_before' ? optInt(fd, 'refund_days_before', 1, 365) : null;
  if (refundPolicy === 'days_before' && !refundDays) return { error: 'Enter how many days before the event refunds are allowed.' } as const;

  let slug = existing?.slug ?? '';
  const wantedSlug = slugify(str(fd, 'slug', 120) || title, 100);
  if (!existing || (str(fd, 'slug', 120) && wantedSlug !== existing.slug)) {
    slug = wantedSlug;
    const clash = await queryOne<Row & { id: number }>(`SELECT id FROM events WHERE slug = ?${existing ? ' AND id <> ?' : ''}`, existing ? [slug, existing.id] : [slug]);
    if (clash) slug = `${slug}-${shortSuffix()}`;
  }

  // Private events carry a secret key in their link; keep the existing one, mint one when switching to private.
  const privateKey = visibility === 'private' ? (existing?.private_key ?? randomToken(12).slice(0, 16)) : null;

  return {
    values: {
      title, slug, venueId: venue?.id ?? null, timezone, startsAt, endsAt, doorsAt, capacity, age: age === null || Number.isNaN(age) ? null : age, visibility, privateKey, feeMode, taxBps,
      taxLabel: str(fd, 'tax_label', 80) || null, summary: str(fd, 'summary', 300) || null, description: str(fd, 'description', 20000) || null,
      refundPolicy, refundDays, allowTransfers: fd.get('allow_transfers') ? 1 : 0, waitlistEnabled: fd.get('waitlist_enabled') ? 1 : 0,
      currency: (str(fd, 'currency', 3) || 'USD').toUpperCase(),
    },
  } as const;
}

export async function createEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  if (!fd.get('fee_mode')) fd.set('fee_mode', (await getSettings()).default_fee_mode);
  const f = await eventFields(fd, ctx.org.id);
  if ('error' in f) return { error: f.error };
  const v = f.values;
  let imagePath: string | null = null;
  const image = fd.get('image');
  if (image instanceof File && image.size > 0) {
    try { imagePath = await saveImageUpload(image, 'events'); } catch (e) { return { error: (e as Error).message }; }
  }
  const r = await execute(
    `INSERT INTO events (organization_id, venue_id, slug, title, summary, description, image_path, starts_at, ends_at, doors_at, timezone, capacity, waitlist_enabled, status, visibility, private_key,
       age_restriction, fee_mode, tax_bps, tax_label, currency, refund_policy, refund_days_before, allow_transfers, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ctx.org.id, v.venueId, v.slug, v.title, v.summary, v.description, imagePath, v.startsAt, v.endsAt, v.doorsAt, v.timezone, v.capacity, v.waitlistEnabled, v.visibility, v.privateKey,
      v.age, v.feeMode, v.taxBps, v.taxLabel, v.currency, v.refundPolicy, v.refundDays, v.allowTransfers, ctx.session.user.id],
  );
  const listingErr = await saveListingFields(fd, r.insertId, ctx.isSuperAdmin);
  if (listingErr) return { error: listingErr };
  await audit('event.created', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: r.insertId, metadata: { title: v.title } });
  revalidateEvent(ctx.org.slug);
  redirect(`/org/${ctx.org.slug}/events/${r.insertId}?created=1`);
}

export async function updateEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const f = await eventFields(fd, ctx.org.id, event);
  if ('error' in f) return { error: f.error };
  const v = f.values;
  let imagePath = event.image_path;
  const image = fd.get('image');
  if (image instanceof File && image.size > 0) {
    try { const p = await saveImageUpload(image, 'events'); await deleteUpload(imagePath); imagePath = p; } catch (e) { return { error: (e as Error).message }; }
  } else if (fd.get('remove_image')) { await deleteUpload(imagePath); imagePath = null; }

  // Multi-day events take their dates from the Schedule tab, not from the details form.
  const multiDay = (await listEventDates(event.id)).length > 0;
  const startsAt = multiDay ? event.starts_at : v.startsAt, endsAt = multiDay ? event.ends_at : v.endsAt, doorsAt = multiDay ? event.doors_at : v.doorsAt;

  await execute(
    `UPDATE events SET venue_id=?, slug=?, title=?, summary=?, description=?, image_path=?, starts_at=?, ends_at=?, doors_at=?, timezone=?, capacity=?, waitlist_enabled=?, visibility=?, private_key=?,
       age_restriction=?, fee_mode=?, tax_bps=?, tax_label=?, currency=?, refund_policy=?, refund_days_before=?, allow_transfers=? WHERE id = ?`,
    [v.venueId, v.slug, v.title, v.summary, v.description, imagePath, startsAt, endsAt, doorsAt, v.timezone, v.capacity, v.waitlistEnabled, v.visibility, v.privateKey,
      v.age, v.feeMode, v.taxBps, v.taxLabel, v.currency, v.refundPolicy, v.refundDays, v.allowTransfers, event.id],
  );
  const listingErr = await saveListingFields(fd, event.id, ctx.isSuperAdmin);
  if (listingErr) return { error: listingErr };
  await audit('event.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  if (v.slug !== event.slug) revalidatePath(`/events/${v.slug}`);
  return { ok: true };
}

/** Private events: mint a new link key; the old link stops working immediately. */
export async function rotatePrivateKey(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  if (event.visibility !== 'private') return { error: 'Only private events have a link key.' };
  await execute(`UPDATE events SET private_key = ? WHERE id = ?`, [randomToken(12).slice(0, 16), event.id]);
  await audit('event.private_key_rotated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true, message: 'New private link generated. Share the new link; the old one no longer works.' };
}

// ---------------------------------------------------------------------------
// Multi-day schedule (event_dates). events.starts_at / ends_at / doors_at mirror the first & last day.
// ---------------------------------------------------------------------------
async function syncEventWindow(eventId: number) {
  const dates = await listEventDates(eventId);
  if (dates.length === 0) return;
  const first = dates[0], last = dates[dates.length - 1];
  await execute(`UPDATE events SET starts_at = ?, doors_at = ?, ends_at = ? WHERE id = ?`, [first.starts_at, first.doors_at, last.ends_at ?? (dates.length > 1 ? last.starts_at : null), eventId]);
}

function dateFields(fd: FormData, timezone: string) {
  const startsAt = wallClockToUtc(str(fd, 'starts_at', 25), timezone);
  if (!startsAt) return { error: 'Enter the start date and time.' } as const;
  const endsRaw = str(fd, 'ends_at', 25), doorsRaw = str(fd, 'doors_at', 25);
  const endsAt = endsRaw ? wallClockToUtc(endsRaw, timezone) : null;
  const doorsAt = doorsRaw ? wallClockToUtc(doorsRaw, timezone) : null;
  if (endsRaw && !endsAt) return { error: 'End time is invalid.' } as const;
  if (endsAt && endsAt <= startsAt) return { error: 'End time must be after the start time.' } as const;
  if (doorsAt && doorsAt > startsAt) return { error: 'Doors must open before the start.' } as const;
  return { values: { label: str(fd, 'label', 80) || null, startsAt, endsAt, doorsAt } } as const;
}

export async function createEventDate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const f = dateFields(fd, event.timezone);
  if ('error' in f) return { error: f.error };
  const existing = await listEventDates(event.id);
  // First extra day: the event's current single date becomes day 1 so nothing is lost.
  if (existing.length === 0) {
    await execute(`INSERT INTO event_dates (event_id, label, starts_at, ends_at, doors_at) VALUES (?, 'Day 1', ?, ?, ?)`, [event.id, event.starts_at, event.ends_at, event.doors_at]);
  }
  const r = await execute(`INSERT INTO event_dates (event_id, label, starts_at, ends_at, doors_at) VALUES (?, ?, ?, ?, ?)`, [event.id, f.values.label ?? `Day ${existing.length ? existing.length + 1 : 2}`, f.values.startsAt, f.values.endsAt, f.values.doorsAt]);
  await syncEventWindow(event.id);
  await audit('event_date.created', { actorUserId: ctx.session.user.id, targetType: 'event_date', targetId: r.insertId, metadata: { eventId: event.id } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function updateEventDate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('date_id'));
  const f = dateFields(fd, event.timezone);
  if ('error' in f) return { error: f.error };
  const r = await execute(`UPDATE event_dates SET label = ?, starts_at = ?, ends_at = ?, doors_at = ? WHERE id = ? AND event_id = ?`, [f.values.label, f.values.startsAt, f.values.endsAt, f.values.doorsAt, id, event.id]);
  if (!r.affectedRows) return { error: 'Day not found.' };
  await syncEventWindow(event.id);
  await audit('event_date.updated', { actorUserId: ctx.session.user.id, targetType: 'event_date', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function deleteEventDate(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('date_id'));
  const sold = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id WHERE t.event_date_id = ?`, [id]);
  if (Number(sold?.n ?? 0) > 0) return { error: 'Tickets have been sold for this day. Postpone or cancel the event instead.' };
  const r = await execute(`DELETE FROM event_dates WHERE id = ? AND event_id = ?`, [id, event.id]);
  if (!r.affectedRows) return { error: 'Day not found.' };
  const remaining = await listEventDates(event.id);
  // Back to a single-day event: keep the remaining day as the event's own date.
  if (remaining.length === 1) {
    await execute(`UPDATE events SET starts_at = ?, ends_at = ?, doors_at = ? WHERE id = ?`, [remaining[0].starts_at, remaining[0].ends_at, remaining[0].doors_at, event.id]);
    await execute(`DELETE FROM event_dates WHERE event_id = ?`, [event.id]);
  } else await syncEventWindow(event.id);
  await audit('event_date.deleted', { actorUserId: ctx.session.user.id, targetType: 'event_date', targetId: id, metadata: { eventId: event.id } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Duplicate / recurring series
// ---------------------------------------------------------------------------
type CopyOpts = { seriesId: string | null; publish: boolean };

/** Deep copy of an event (details, image, schedule, ticket types, add-ons, questions) shifted to a new start. */
async function copyEvent(src: EventRow & { image_path: string | null }, newStart: Date, actorId: number, opts: CopyOpts): Promise<number> {
  const shiftMs = newStart.getTime() - new Date(src.starts_at).getTime();
  const shift = (d: Date | string | null) => (d ? new Date(new Date(d).getTime() + shiftMs) : null);
  const dateTag = new Intl.DateTimeFormat('en-CA', { timeZone: src.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(newStart);
  let slug = slugify(`${src.slug.replace(/-\d{4}-\d{2}-\d{2}(-[a-z0-9]{4,6})?$/, '')}-${dateTag}`, 110);
  if (await queryOne(`SELECT 1 FROM events WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;
  const imagePath = await copyUpload(src.image_path);
  const status = opts.publish && src.status === 'published' ? 'published' : 'draft';
  const r = await execute(
    `INSERT INTO events (organization_id, venue_id, slug, series_id, title, summary, description, image_path, starts_at, ends_at, doors_at, timezone, capacity, waitlist_enabled, status, visibility, private_key,
       age_restriction, fee_mode, tax_bps, tax_label, currency, refund_policy, refund_days_before, allow_transfers, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [src.organization_id, src.venue_id, slug, opts.seriesId, src.title, src.summary, src.description, imagePath, newStart, shift(src.ends_at), shift(src.doors_at), src.timezone, src.capacity, src.waitlist_enabled,
      status, src.visibility, src.visibility === 'private' ? randomToken(12).slice(0, 16) : null, src.age_restriction, src.fee_mode, src.tax_bps, src.tax_label, src.currency, src.refund_policy, src.refund_days_before, src.allow_transfers, actorId],
  );
  const newId = r.insertId;
  // Schedule days.
  const dateMap = new Map<number, number>();
  for (const d of await listEventDates(src.id)) {
    const nd = await execute(`INSERT INTO event_dates (event_id, label, starts_at, ends_at, doors_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, [newId, d.label, shift(d.starts_at), shift(d.ends_at), shift(d.doors_at), d.sort_order]);
    dateMap.set(Number(d.id), nd.insertId);
  }
  // Ticket types (inventory reset, sales windows shifted).
  const types = await query<Row & { id: number; name: string; description: string | null; kind: string; price_cents: number; quantity: number; min_per_order: number; max_per_order: number; max_per_account: number | null; seats_per_unit: number; event_date_id: number | null; sales_start_at: Date | null; sales_end_at: Date | null; hidden: number; access_code: string | null; sort_order: number }>(`SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order, id`, [src.id]);
  for (const t of types) {
    await execute(
      `INSERT INTO ticket_types (event_id, name, description, kind, price_cents, quantity, min_per_order, max_per_order, seats_per_unit, event_date_id, sales_start_at, sales_end_at, hidden, access_code, sort_order, max_per_account)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, t.name, t.description, t.kind, t.price_cents, t.quantity, t.min_per_order, t.max_per_order, t.seats_per_unit, t.event_date_id ? dateMap.get(Number(t.event_date_id)) ?? null : null, shift(t.sales_start_at), shift(t.sales_end_at), t.hidden, t.access_code, t.sort_order, t.max_per_account ?? null],
    );
  }
  await execute(`INSERT INTO event_addons (event_id, name, description, price_cents, quantity, max_per_order, active, sort_order) SELECT ?, name, description, price_cents, quantity, max_per_order, active, sort_order FROM event_addons WHERE event_id = ?`, [newId, src.id]);
  await execute(`INSERT INTO event_questions (event_id, label, kind, required, options, sort_order) SELECT ?, label, kind, required, options, sort_order FROM event_questions WHERE event_id = ?`, [newId, src.id]);
  return newId;
}

/**
 * Duplicate once (mode=single) or create a recurring series (mode=series: every day / week / 2 weeks / month,
 * N more occurrences). The original joins the series so the public page can link to the other dates.
 */
export async function duplicateEvent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const mode = str(fd, 'mode', 10) === 'series' ? 'series' : 'single';
  const publish = !!fd.get('publish');
  if (mode === 'single') {
    const newStart = wallClockToUtc(str(fd, 'new_starts_at', 25), event.timezone);
    if (!newStart) return { error: 'Enter the date and time of the copy.' };
    const id = await copyEvent(event, newStart, ctx.session.user.id, { seriesId: event.series_id, publish });
    await audit('event.duplicated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: id, metadata: { from: event.id } });
    revalidateEvent(ctx.org.slug, event.id, event.slug);
    redirect(`/org/${ctx.org.slug}/events/${id}?created=1`);
  }
  const frequency = str(fd, 'frequency', 10);
  const step: { days?: number; months?: number } | null = frequency === 'daily' ? { days: 1 } : frequency === 'weekly' ? { days: 7 } : frequency === 'biweekly' ? { days: 14 } : frequency === 'monthly' ? { months: 1 } : null;
  if (!step) return { error: 'Choose how often the event repeats.' };
  const count = optInt(fd, 'count', 1, 52);
  if (!count || Number.isNaN(count)) return { error: 'Enter how many more occurrences to create (1–52).' };
  const seriesId = event.series_id ?? randomToken(12).slice(0, 16);
  if (!event.series_id) await execute(`UPDATE events SET series_id = ? WHERE id = ?`, [seriesId, event.id]);
  let start = new Date(event.starts_at);
  const created: number[] = [];
  for (let i = 0; i < count; i++) {
    start = shiftWallClock(start, event.timezone, step);
    created.push(await copyEvent(event, start, ctx.session.user.id, { seriesId, publish }));
  }
  await audit('event.series_created', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { seriesId, frequency, created } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true, message: `${created.length} more ${created.length === 1 ? 'occurrence' : 'occurrences'} created${publish && event.status === 'published' ? ' and published' : ' as drafts'}.` };
}

export async function setEventStatus(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const status = str(fd, 'status', 20);
  if (!['draft', 'published', 'completed'].includes(status)) return { error: 'Invalid status.' };
  if (status === 'published') {
    const tt = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ?`, [event.id]);
    if (!Number(tt?.n ?? 0)) return { error: 'Add at least one ticket type before publishing.' };
    if (event.status === 'cancelled') return { error: 'A cancelled event cannot be re-published. Create a new event.' };
  }
  await execute(`UPDATE events SET status = ? WHERE id = ?`, [status, event.id]);
  await audit(status === 'published' ? 'event.published' : status === 'draft' ? 'event.unpublished' : 'event.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { status } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function deleteEvent(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')), 'org_admin');
  const sold = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE event_id = ? AND status <> 'expired'`, [event.id]);
  const orders = Number(sold?.n ?? 0);
  // Organization Admins may only delete events without orders; the Super Admin may force-delete anything
  // (orders, tickets and check-in records go with it). No refunds are issued here: cancel the event first for that.
  if (orders > 0 && !ctx.isSuperAdmin) return { error: 'This event has orders and cannot be deleted. Cancel it instead.' };
  await deleteUpload(event.image_path);
  await execute(`DELETE FROM events WHERE id = ?`, [event.id]);
  await audit('event.deleted', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { title: event.title, orders, forced: orders > 0 } });
  revalidateEvent(ctx.org.slug, undefined, event.slug);
  redirect(`/org/${ctx.org.slug}/events`);
}

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------
function ticketTypeFields(fd: FormData, timezone: string, dateIds: number[]) {
  const name = str(fd, 'name', 120);
  if (name.length < 2) return { error: 'Enter a ticket name.' } as const;
  const kind = str(fd, 'kind', 20);
  if (!['general', 'vip', 'table', 'complimentary'].includes(kind)) return { error: 'Choose a ticket kind.' } as const;
  const price = kind === 'complimentary' ? 0 : parseDollarsToCents(str(fd, 'price', 12) || '0');
  if (price === null) return { error: 'Enter a valid price, e.g. 25.00.' } as const;
  const quantity = optInt(fd, 'quantity', 1, 1_000_000);
  if (!quantity || Number.isNaN(quantity)) return { error: 'Enter the quantity available.' } as const;
  const minPer = optInt(fd, 'min_per_order', 1, 100) ?? 1;
  const maxPer = optInt(fd, 'max_per_order', 1, 100) ?? 10;
  if (Number.isNaN(minPer) || Number.isNaN(maxPer) || minPer > maxPer) return { error: 'Minimum per order cannot exceed the maximum.' } as const;
  const maxPerAccount = optInt(fd, 'max_per_account', 1, 1000);
  if (Number.isNaN(maxPerAccount)) return { error: 'Limit per person must be a whole number (blank = no limit).' } as const;
  if (maxPerAccount !== null && maxPerAccount < minPer) return { error: 'The limit per person cannot be lower than the minimum per order.' } as const;
  const seats = kind === 'table' ? (optInt(fd, 'seats_per_unit', 1, 50) ?? 1) : 1;
  if (Number.isNaN(seats)) return { error: 'Seats per table must be a whole number.' } as const;
  const startRaw = str(fd, 'sales_start_at', 25), endRaw = str(fd, 'sales_end_at', 25);
  const salesStart = startRaw ? wallClockToUtc(startRaw, timezone) : null;
  const salesEnd = endRaw ? wallClockToUtc(endRaw, timezone) : null;
  if ((startRaw && !salesStart) || (endRaw && !salesEnd)) return { error: 'Sales window dates are invalid.' } as const;
  if (salesStart && salesEnd && salesEnd <= salesStart) return { error: 'Sales must end after they start.' } as const;
  const dateRaw = optInt(fd, 'event_date_id', 1);
  const eventDateId = dateRaw && !Number.isNaN(dateRaw) ? dateRaw : null;
  if (eventDateId && !dateIds.includes(eventDateId)) return { error: 'Choose a day from this event’s schedule.' } as const;
  const accessCode = str(fd, 'access_code', 40).replace(/\s+/g, '') || null;
  if (accessCode && !/^[A-Za-z0-9_-]{3,40}$/.test(accessCode)) return { error: 'Access codes use 3–40 letters, numbers, dashes or underscores.' } as const;
  // A ticket type with an access code is a presale: always hidden until unlocked.
  const hidden = fd.get('hidden') || kind === 'complimentary' || accessCode ? 1 : 0;
  return {
    values: [name, str(fd, 'description', 500) || null, kind, price, quantity, minPer, maxPer, seats, eventDateId, salesStart, salesEnd, hidden, accessCode, optInt(fd, 'sort_order', 0, 1000) ?? 0, maxPerAccount] as const,
  };
}

export async function createTicketType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const f = ticketTypeFields(fd, event.timezone, (await listEventDates(event.id)).map((d) => Number(d.id)));
  if ('error' in f) return { error: f.error };
  const r = await execute(
    `INSERT INTO ticket_types (event_id, name, description, kind, price_cents, quantity, min_per_order, max_per_order, seats_per_unit, event_date_id, sales_start_at, sales_end_at, hidden, access_code, sort_order, max_per_account)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event.id, ...f.values],
  );
  await audit('ticket_type.created', { actorUserId: ctx.session.user.id, targetType: 'ticket_type', targetId: r.insertId, metadata: { eventId: event.id } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function updateTicketType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('ticket_type_id'));
  const f = ticketTypeFields(fd, event.timezone, (await listEventDates(event.id)).map((d) => Number(d.id)));
  if ('error' in f) return { error: f.error };
  const current = await queryOne<Row & { sold: number }>(`SELECT sold FROM ticket_types WHERE id = ? AND event_id = ?`, [id, event.id]);
  if (!current) return { error: 'Ticket type not found.' };
  if (f.values[4] < Number(current.sold)) return { error: `Quantity cannot be lower than the ${current.sold} already sold.` };
  await execute(
    `UPDATE ticket_types SET name=?, description=?, kind=?, price_cents=?, quantity=?, min_per_order=?, max_per_order=?, seats_per_unit=?, event_date_id=?, sales_start_at=?, sales_end_at=?, hidden=?, access_code=?, sort_order=?, max_per_account=? WHERE id = ? AND event_id = ?`,
    [...f.values, id, event.id],
  );
  await audit('ticket_type.updated', { actorUserId: ctx.session.user.id, targetType: 'ticket_type', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function deleteTicketType(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('ticket_type_id'));
  const used = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM order_items WHERE ticket_type_id = ?`, [id]);
  if (Number(used?.n ?? 0) > 0) return { error: 'Tickets of this type have been ordered. Hide it or set the quantity to what is sold instead.' };
  await execute(`DELETE FROM ticket_types WHERE id = ? AND event_id = ?`, [id, event.id]);
  await audit('ticket_type.deleted', { actorUserId: ctx.session.user.id, targetType: 'ticket_type', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Event staff assignment
// ---------------------------------------------------------------------------
export async function setEventMember(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const userId = Number(fd.get('user_id'));
  const assigned = str(fd, 'assigned', 1) === '1';
  const member = await queryOne(`SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ?`, [ctx.org.id, userId]);
  if (!member) return { error: 'That person is not a member of this organization.' };
  if (assigned) {
    await execute(`INSERT IGNORE INTO event_members (event_id, user_id, assigned_by) VALUES (?, ?, ?)`, [event.id, userId, ctx.session.user.id]);
    await audit('event.member.assigned', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { userId } });
  } else {
    await execute(`DELETE FROM event_members WHERE event_id = ? AND user_id = ?`, [event.id, userId]);
    await audit('event.member.unassigned', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { userId } });
  }
  revalidateEvent(ctx.org.slug, event.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Add-ons (parking, merchandise, …)
// ---------------------------------------------------------------------------
function addonFields(fd: FormData) {
  const name = str(fd, 'name', 120);
  if (name.length < 2) return { error: 'Enter the add-on name.' } as const;
  const price = parseDollarsToCents(str(fd, 'price', 12) || '0');
  if (price === null) return { error: 'Enter a valid price, e.g. 15.00.' } as const;
  const quantity = optInt(fd, 'quantity', 0, 1_000_000);
  if (Number.isNaN(quantity)) return { error: 'Quantity must be a whole number (blank = unlimited).' } as const;
  const maxPer = optInt(fd, 'max_per_order', 1, 100) ?? 10;
  if (Number.isNaN(maxPer)) return { error: 'Max per order must be between 1 and 100.' } as const;
  return { values: [name, str(fd, 'description', 500) || null, price, quantity, maxPer, fd.get('active') ? 1 : 0, optInt(fd, 'sort_order', 0, 1000) ?? 0] as const };
}

export async function createAddon(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const f = addonFields(fd);
  if ('error' in f) return { error: f.error };
  const r = await execute(`INSERT INTO event_addons (event_id, name, description, price_cents, quantity, max_per_order, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [event.id, ...f.values]);
  await audit('addon.created', { actorUserId: ctx.session.user.id, targetType: 'addon', targetId: r.insertId, metadata: { eventId: event.id } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function updateAddon(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('addon_id'));
  const f = addonFields(fd);
  if ('error' in f) return { error: f.error };
  const current = await queryOne<Row & { sold: number }>(`SELECT sold FROM event_addons WHERE id = ? AND event_id = ?`, [id, event.id]);
  if (!current) return { error: 'Add-on not found.' };
  if (f.values[3] !== null && f.values[3] < Number(current.sold)) return { error: `Quantity cannot be lower than the ${current.sold} already sold.` };
  await execute(`UPDATE event_addons SET name=?, description=?, price_cents=?, quantity=?, max_per_order=?, active=?, sort_order=? WHERE id = ? AND event_id = ?`, [...f.values, id, event.id]);
  await audit('addon.updated', { actorUserId: ctx.session.user.id, targetType: 'addon', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function deleteAddon(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('addon_id'));
  const used = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM order_addons WHERE addon_id = ?`, [id]);
  if (Number(used?.n ?? 0) > 0) return { error: 'This add-on has been ordered. Deactivate it instead.' };
  await execute(`DELETE FROM event_addons WHERE id = ? AND event_id = ?`, [id, event.id]);
  await audit('addon.deleted', { actorUserId: ctx.session.user.id, targetType: 'addon', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Checkout questions
// ---------------------------------------------------------------------------
function questionFields(fd: FormData) {
  const label = str(fd, 'label', 200);
  if (label.length < 3) return { error: 'Enter the question.' } as const;
  const kind = str(fd, 'kind', 10);
  if (!['text', 'textarea', 'select', 'checkbox'].includes(kind)) return { error: 'Choose an answer type.' } as const;
  const options = kind === 'select' ? str(fd, 'options', 2000).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join('\n') : null;
  if (kind === 'select' && (!options || options.split('\n').length < 2)) return { error: 'Enter at least two options, one per line.' } as const;
  return { values: [label, kind, fd.get('required') ? 1 : 0, options, optInt(fd, 'sort_order', 0, 1000) ?? 0] as const };
}

export async function createQuestion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const f = questionFields(fd);
  if ('error' in f) return { error: f.error };
  const r = await execute(`INSERT INTO event_questions (event_id, label, kind, required, options, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, [event.id, ...f.values]);
  await audit('question.created', { actorUserId: ctx.session.user.id, targetType: 'question', targetId: r.insertId, metadata: { eventId: event.id } });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

export async function updateQuestion(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('question_id'));
  const f = questionFields(fd);
  if ('error' in f) return { error: f.error };
  const r = await execute(`UPDATE event_questions SET label=?, kind=?, required=?, options=?, sort_order=? WHERE id = ? AND event_id = ?`, [...f.values, id, event.id]);
  if (!r.affectedRows) return { error: 'Question not found.' };
  await audit('question.updated', { actorUserId: ctx.session.user.id, targetType: 'question', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}

/** Deleting a question keeps the answers already given (they carry a snapshot of the label). */
export async function deleteQuestion(fd: FormData): Promise<ActionState> {
  const { ctx, event } = await loadEventForEdit(str(fd, 'org', 64), Number(fd.get('event_id')));
  const id = Number(fd.get('question_id'));
  const r = await execute(`DELETE FROM event_questions WHERE id = ? AND event_id = ?`, [id, event.id]);
  if (!r.affectedRows) return { error: 'Question not found.' };
  await audit('question.deleted', { actorUserId: ctx.session.user.id, targetType: 'question', targetId: id });
  revalidateEvent(ctx.org.slug, event.id, event.slug);
  return { ok: true };
}
