'use server';

/*
 * Saves the event drafted on /create (plan 5.6). Anyone can fill in the page; the sign-up window at the end signs the
 * visitor in (src/lib/auth/passwordless-actions.ts), and publishDraft() then saves the event under their organization,
 * creating that organization on the spot for a new organizer (with the Organizer Agreement acceptance recorded).
 * A free event goes live at once. A paid event goes live at once only for a verified organization; otherwise it is held
 * 'in_review' until the organization's verification is approved (src/lib/orgs/verification.ts). A live paid event whose
 * organization can't be paid yet gets the "Set up payouts" banner and reminder emails, and payouts wait until setup is
 * done (plan 5.6.9, "live now, payouts later"). saveEventEdits() saves the same page when it edits an existing event (plan 5.6.12).
 */

import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { getSession, type CurrentSession } from '../auth/session';
import { assertOrg, canAccessEvent, listMemberships } from '../authz';
import { execute, queryOne, type Row } from '../db';
import { env } from '../env';
import { encryptEventPassword } from '../events/password';
import { getEvent, listEventDates, listEventPhotos, listTicketTypes, MAX_EVENT_PHOTOS, publicEventPath, type EventListRow } from '../events/queries';
import { eventSnapshot, notifyEventChanged } from '../events/notify';
import { geocodeAddress } from '../places';
import { holdIfUnverified, liveStatus } from '../orgs/verification';
import { payoutsReady } from '../payments/connect';
import { rateLimited } from '../security/bot';
import { randomToken } from '../security/crypto';
import { shortSuffix, slugify } from '../slug';
import { isValidTimeZone, wallClockToUtc } from '../tz';
import { deleteUpload, saveImageUpload } from '../uploads';
import { youtubeId, youtubeUrl } from '../video';
import { categoryNames } from '../site-content/categories';
import { checkDraft, parseDraftForServer, refundPolicyOf, type EventDraft, type GalleryPost, type TicketDraft } from './create';
import { parseDollars } from './pricing';

export type CreateState =
  | { error: string; needsAuth?: boolean }
  | { ok: true; url: string; manageUrl: string; editUrl: string; published: boolean; inReview: boolean; verified: boolean; payoutsNeeded: boolean; passwordFor: string | null; orgName: string; orgSlug: string; dashboardUrl: string; notified?: number }
  | undefined;

const MAX_QUANTITY = 1_000_000;

type Host = { id: number; slug: string; name: string; verified: boolean };
type Draft = ReturnType<typeof parseDraftForServer>;

function readDraft(fd: FormData): Draft | { error: string } {
  try {
    return parseDraftForServer(String(fd.get('draft') ?? ''));
  } catch {
    return { error: 'The event details could not be read. Reload the page and try again.' };
  }
}

// ---------------------------------------------------------------------------
// Which organization hosts it (created on the spot for a new organizer)
// ---------------------------------------------------------------------------
async function hostFor(session: CurrentSession, fd: FormData): Promise<Host | { error: string }> {
  const wanted = String(fd.get('org') ?? '').trim();
  if (wanted) {
    // a member (Organization Admin / Organizer), or platform staff working inside the organization from the console
    const ctx = await assertOrg(wanted, 'organizer').catch(() => null);
    if (!ctx) return { error: 'You can’t create events for that organization.' };
    if (ctx.org.status !== 'active') return { error: 'This organization is suspended.' };
    return { id: Number(ctx.org.id), slug: ctx.org.slug, name: ctx.org.name, verified: !!ctx.org.verified_at };
  }
  const memberships = (await listMemberships(session.user.id)).filter((m) => m.status === 'active' && m.role !== 'staff');
  if (memberships.length === 1 && fd.get('new_org') !== '1') {
    const m = memberships[0];
    const row = await queryOne<Row & { verified_at: Date | null }>(`SELECT verified_at FROM organizations WHERE id = ?`, [m.organization_id]);
    return { id: Number(m.organization_id), slug: m.slug, name: m.name, verified: !!row?.verified_at };
  }
  if (memberships.length && fd.get('new_org') !== '1') return { error: 'Choose which organization hosts this event.' };
  return createOrganizationFor(session, fd);
}

/** A new organizer names their organization in the sign-up window and accepts the Organizer Agreement. */
async function createOrganizationFor(session: CurrentSession, fd: FormData): Promise<Host | { error: string }> {
  const name = String(fd.get('organizer_name') ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (name.length < 2) return { error: 'Add the organizer name buyers will see.' };
  if (fd.get('agree') !== '1') return { error: 'Please accept the Terms of Service and Organizer Agreement.' };
  // a retry after a failed save must not create a second organization with the same name
  const same = await queryOne<Row & { id: number; slug: string; name: string; verified_at: Date | null }>(
    `SELECT g.id, g.slug, g.name, g.verified_at FROM organizations g JOIN organization_members m ON m.organization_id = g.id AND m.user_id = ? AND m.role = 'org_admin'
      WHERE LOWER(g.name) = LOWER(?) AND g.status = 'active' ORDER BY g.id DESC LIMIT 1`, [session.user.id, name],
  );
  if (same) return { id: Number(same.id), slug: same.slug, name: same.name, verified: !!same.verified_at };
  if (rateLimited(`create-org:${session.user.id}`, 3, 60 * 60_000)) return { error: 'Too many organizers created in a short time. Please try again later.' };
  const user = await queryOne<Row & { phone_e164: string | null; phone: string | null }>(`SELECT phone_e164, phone FROM users WHERE id = ?`, [session.user.id]);
  let slug = slugify(name, 60);
  if (await queryOne(`SELECT 1 FROM organizations WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;
  const r = await execute(
    `INSERT INTO organizations (slug, name, contact_email, contact_phone, created_by, agreement_accepted_at, agreement_accepted_by) VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
    [slug, name, session.user.email, user?.phone_e164 ?? user?.phone ?? null, session.user.id, session.user.id],
  );
  await execute(`INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'org_admin')`, [r.insertId, session.user.id]);
  await audit('org.created', { actorUserId: session.user.id, targetType: 'organization', targetId: r.insertId, metadata: { name, slug, viaCreatePage: true, agreementAccepted: true } });
  await audit('org.member.added', { actorUserId: session.user.id, targetType: 'organization', targetId: r.insertId, metadata: { userId: session.user.id, role: 'org_admin' } });
  return { id: r.insertId, slug, name, verified: false };
}

// ---------------------------------------------------------------------------
// Where: a saved venue, a new one (with its map position), or an online link
// ---------------------------------------------------------------------------
async function resolveLocation(draft: EventDraft, orgId: number, userId: number): Promise<{ venueId: number | null; onlineUrl: string | null } | { error: string }> {
  const l = draft.location;
  if (l.kind === 'online') return { venueId: null, onlineUrl: l.link };
  if (l.kind === 'saved') {
    const v = await queryOne<Row & { id: number }>(`SELECT id FROM venues WHERE id = ? AND organization_id = ?`, [Number(l.venueId), orgId]);
    return v ? { venueId: Number(v.id), onlineUrl: null } : { error: 'Choose a venue from the list.' };
  }
  let { lat, lon } = l;
  if (lat == null || lon == null) {
    // typed by hand: look the address up so the event still shows in "Events near you"
    const found = await geocodeAddress({ name: l.venueName, address: l.address, city: l.city, region: l.region, postalCode: l.postalCode, country: l.country });
    if (found) ({ lat, lon } = found);
  }
  const name = (l.venueName || l.address || l.city).trim().slice(0, 160);
  const r = await execute(
    `INSERT INTO venues (organization_id, name, address_line1, city, region, postal_code, country, latitude, longitude, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId, name, l.address.trim().slice(0, 200) || null, l.city.trim().slice(0, 120) || null, l.region.trim().slice(0, 120) || null, l.postalCode.trim() || null, l.country || 'US', lat, lon, draft.timeZone],
  );
  await audit('venue.created', { actorUserId: userId, targetType: 'venue', targetId: r.insertId, metadata: { name, viaCreatePage: true, mapped: lat != null } });
  return { venueId: r.insertId, onlineUrl: null };
}

// ---------------------------------------------------------------------------
// The event's own fields
// ---------------------------------------------------------------------------
type Columns = {
  title: string; summary: string | null; description: string | null; startsAt: Date; endsAt: Date | null; showEnd: number; doorsAt: Date | null; timezone: string;
  capacity: number | null; waitlist: number; visibility: 'public' | 'unlisted' | 'private'; age: number | null; feeMode: 'buyer_pays' | 'organizer_absorbs';
  taxBps: number | null; taxLabel: string | null; refundPolicy: string; refundDays: number | null; allowTransfers: number; category: string;
  videoUrl: string | null; password: string | null;
};

async function columnsFrom(draft: EventDraft, editing?: { startDate: string; startTime: string; otherTickets?: number }): Promise<Columns | { error: string }> {
  const problems = checkDraft(draft, new Date(), editing);
  if (problems.length) return { error: problems[0].message };
  if (!(await categoryNames()).includes(draft.category)) return { error: 'Pick a category from the list.' };
  if (!isValidTimeZone(draft.timeZone)) return { error: 'Choose a valid time zone.' };
  const startsAt = wallClockToUtc(`${draft.startDate}T${draft.startTime}`, draft.timeZone);
  if (!startsAt) return { error: 'Enter the start date and time.' };
  const endsAt = draft.endDate && draft.endTime ? wallClockToUtc(`${draft.endDate}T${draft.endTime}`, draft.timeZone) : null;
  const doorsAt = draft.doorsTime ? wallClockToUtc(`${draft.startDate}T${draft.doorsTime}`, draft.timeZone) : null;
  if (doorsAt && doorsAt > startsAt) return { error: 'Doors must open before the event starts.' };
  const taxBps = draft.taxPct.trim() === '' ? null : Math.round(Number(draft.taxPct) * 100);
  if (taxBps !== null && (!Number.isFinite(taxBps) || taxBps < 0 || taxBps > 3000)) return { error: 'Tax must be between 0 and 30 percent, or blank to use the venue rate.' };
  const video = youtubeId(draft.videoUrl);
  const password = draft.password.trim();
  return {
    title: draft.name.trim(), summary: draft.summary.trim() || null, description: draft.description.trim() || null,
    startsAt, endsAt, showEnd: draft.showEnd ? 1 : 0, doorsAt, timezone: draft.timeZone,
    capacity: draft.capacity ? Math.min(MAX_QUANTITY, Math.max(1, Number(draft.capacity))) : null,
    waitlist: draft.waitlist ? 1 : 0,
    visibility: draft.visibility,
    age: draft.age === 'all' ? null : Number(draft.age),
    feeMode: draft.feePayer === 'buyer' ? 'buyer_pays' : 'organizer_absorbs',
    taxBps, taxLabel: draft.taxLabel.trim().slice(0, 80) || null,
    refundPolicy: refundPolicyOf(draft.refund), refundDays: draft.refund === 'days_before' ? Number(draft.refundDays) : null,
    allowTransfers: draft.allowTransfers ? 1 : 0, category: draft.category,
    videoUrl: video ? youtubeUrl(video) : null,
    password: password ? encryptEventPassword(password) : null,
  };
}

/** Cover and new gallery photos are stored before anything is written, so a bad image changes nothing. */
async function uploadImages(fd: FormData, gallery: GalleryPost[]): Promise<{ cover: string | null; photos: Map<string, string> } | { error: string }> {
  const saved: string[] = [];
  try {
    const cover = fd.get('cover');
    const coverPath = cover instanceof File && cover.size > 0 ? await saveImageUpload(cover, 'events') : null;
    if (coverPath) saved.push(coverPath);
    const photos = new Map<string, string>();
    for (const g of gallery) {
      if (!('file' in g)) continue;
      const f = fd.get(g.file);
      if (f instanceof File && f.size > 0) {
        const p = await saveImageUpload(f, 'events');
        saved.push(p);
        photos.set(g.file, p);
      }
    }
    return { cover: coverPath, photos };
  } catch (e) {
    for (const p of saved) await deleteUpload(p);
    return { error: (e as Error).message };
  }
}

/** The gallery in the order shown on the page: saved photos kept, new ones added, the rest removed. */
async function saveGallery(eventId: number, gallery: GalleryPost[], uploaded: Map<string, string>, userId: number): Promise<void> {
  const existing = await listEventPhotos(eventId);
  const keep = new Set(gallery.flatMap((g) => ('keep' in g ? [g.keep] : [])));
  for (const p of existing) {
    if (keep.has(Number(p.id))) continue;
    await execute(`DELETE FROM event_photos WHERE id = ? AND event_id = ?`, [p.id, eventId]);
    await deleteUpload(p.image_path);
    await audit('event_photo.deleted', { actorUserId: userId, targetType: 'event', targetId: eventId, metadata: { photoId: Number(p.id) } });
  }
  let sort = 0;
  for (const g of gallery.slice(0, MAX_EVENT_PHOTOS)) {
    if ('keep' in g) {
      await execute(`UPDATE event_photos SET sort_order = ? WHERE id = ? AND event_id = ?`, [sort++, g.keep, eventId]);
    } else {
      const path = uploaded.get(g.file);
      if (!path) continue;
      const r = await execute(`INSERT INTO event_photos (event_id, image_path, sort_order) VALUES (?, ?, ?)`, [eventId, path, sort++]);
      await audit('event_photo.added', { actorUserId: userId, targetType: 'event', targetId: eventId, metadata: { photoId: r.insertId } });
    }
  }
}

type TicketValues = { name: string; priceCents: number; quantity: number; min: number; max: number; salesStart: Date | null; salesEnd: Date | null; description: string | null; hidden: number };

function ticketValues(t: TicketDraft, timeZone: string, capacity: number | null): TicketValues {
  const min = Math.max(1, Number(t.minPerOrder) || 1);
  return {
    name: t.name.trim().slice(0, 120),
    priceCents: parseDollars(t.price),
    quantity: t.quantity ? Math.min(MAX_QUANTITY, Math.max(1, Number(t.quantity))) : capacity ?? MAX_QUANTITY,
    min,
    max: Math.max(min, Number(t.maxPerOrder) || 10),
    salesStart: t.salesStart ? wallClockToUtc(t.salesStart, timeZone) : null,
    salesEnd: t.salesEnd ? wallClockToUtc(t.salesEnd, timeZone) : null,
    description: t.description.trim().slice(0, 500) || null,
    hidden: t.hidden ? 1 : 0,
  };
}

async function insertTicket(eventId: number, t: TicketValues, sort: number, userId: number): Promise<void> {
  const r = await execute(
    `INSERT INTO ticket_types (event_id, name, description, kind, price_cents, quantity, min_per_order, max_per_order, seats_per_unit, sales_start_at, sales_end_at, hidden, sort_order)
     VALUES (?, ?, ?, 'general', ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [eventId, t.name, t.description, t.priceCents, t.quantity, t.min, t.max, t.salesStart, t.salesEnd, t.hidden, sort],
  );
  await audit('ticket_type.created', { actorUserId: userId, targetType: 'ticket_type', targetId: r.insertId, metadata: { eventId, viaCreatePage: true } });
}

type TicketPlan = { removed: number[]; changes: { serverId: number | null; values: TicketValues }[]; nextSort: number };

/**
 * Ticket types the page edits are the simple ones it creates (general admission, one seat, no presale code, no day).
 * VIP, tables, comps, presale, day tickets and reserved seating tiers stay on the dashboard's Ticket types and Seating
 * tabs and are left untouched here.
 * Checked in full before anything is written (applyTicketPlan).
 */
async function planTickets(eventId: number, drafts: TicketDraft[], timeZone: string, capacity: number | null): Promise<TicketPlan | { error: string }> {
  const existing = await listTicketTypes(eventId);
  const editable = existing.filter((t) => t.kind === 'general' && !t.event_date_id && !t.access_code && Number(t.seats_per_unit) === 1 && !t.seated);
  const byId = new Map(editable.map((t) => [Number(t.id), t]));
  const changes: TicketPlan['changes'] = [];
  for (const d of drafts) {
    const values = ticketValues(d, timeZone, capacity);
    if (d.serverId != null) {
      const cur = byId.get(d.serverId);
      if (!cur) return { error: 'One of the tickets was changed elsewhere. Reload the page and try again.' };
      if (values.quantity < Number(cur.sold)) return { error: `${cur.name}: ${cur.sold} are already sold, so the quantity can't be lower.` };
    }
    changes.push({ serverId: d.serverId ?? null, values });
  }
  const kept = new Set(drafts.flatMap((d) => (d.serverId != null ? [d.serverId] : [])));
  const removed = editable.filter((t) => !kept.has(Number(t.id)));
  for (const t of removed) {
    const used = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM order_items WHERE ticket_type_id = ?`, [t.id]);
    if (Number(used?.n ?? 0) > 0) return { error: `${t.name} has orders, so it can't be removed. Hide it, or set its quantity to what's sold, instead.` };
  }
  if (!drafts.length && existing.length === removed.length) return { error: 'Keep at least one ticket.' };
  return { removed: removed.map((t) => Number(t.id)), changes, nextSort: existing.reduce((m, t) => Math.max(m, Number(t.sort_order)), -1) + 1 };
}

async function applyTicketPlan(eventId: number, plan: TicketPlan, userId: number): Promise<void> {
  for (const id of plan.removed) {
    await execute(`DELETE FROM ticket_types WHERE id = ? AND event_id = ?`, [id, eventId]);
    await audit('ticket_type.deleted', { actorUserId: userId, targetType: 'ticket_type', targetId: id, metadata: { viaCreatePage: true } });
  }
  let sort = plan.nextSort;
  for (const { serverId, values: v } of plan.changes) {
    if (serverId == null) {
      await insertTicket(eventId, v, sort++, userId);
      continue;
    }
    await execute(
      `UPDATE ticket_types SET name = ?, description = ?, price_cents = ?, quantity = ?, min_per_order = ?, max_per_order = ?, sales_start_at = ?, sales_end_at = ?, hidden = ? WHERE id = ? AND event_id = ?`,
      [v.name, v.description, v.priceCents, v.quantity, v.min, v.max, v.salesStart, v.salesEnd, v.hidden, serverId, eventId],
    );
    await audit('ticket_type.updated', { actorUserId: userId, targetType: 'ticket_type', targetId: serverId, metadata: { viaCreatePage: true } });
  }
}

function revalidateEventPages(orgSlug: string, eventId: number, slugs: string[]) {
  revalidatePath('/');
  revalidatePath('/events');
  revalidatePath(`/org/${orgSlug}/events`);
  revalidatePath(`/org/${orgSlug}/events/${eventId}`);
  for (const s of slugs) revalidatePath(`/events/${s}`);
}

/** Organizers who signed up with a one-time code have no password yet; the confirmation screen offers to set one. */
async function needsPassword(userId: number): Promise<boolean> {
  return !!(await queryOne(`SELECT 1 FROM users WHERE id = ? AND password_hash IS NULL`, [userId]));
}

// ---------------------------------------------------------------------------
// New event
// ---------------------------------------------------------------------------
export async function publishDraft(_prev: CreateState, fd: FormData): Promise<CreateState> {
  const session = await getSession();
  if (!session) return { error: 'Sign in to create your event. Your draft stays in this browser.', needsAuth: true };
  if (rateLimited(`create:${session.user.id}`, 20, 10 * 60_000)) return { error: 'Too many events created in a short time. Please try again later.' };

  const draft = readDraft(fd);
  if ('error' in draft) return draft;
  const cols = await columnsFrom(draft);
  if ('error' in cols) return cols;
  const images = await uploadImages(fd, draft.galleryPost);
  if ('error' in images) return images;
  const discard = async () => { for (const p of [images.cover, ...images.photos.values()]) await deleteUpload(p); };
  // after the checks above, so a new organizer's organization is only created when the event can be saved too
  const org = await hostFor(session, fd);
  if ('error' in org) return (await discard(), org);
  const where = await resolveLocation(draft, org.id, session.user.id);
  if ('error' in where) return (await discard(), where);

  let slug = slugify(draft.name, 100);
  if (await queryOne(`SELECT 1 FROM events WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;
  const privateKey = cols.visibility === 'private' ? randomToken(12).slice(0, 16) : null;
  const featured = draft.featured && session.user.roles.includes('super_admin') ? 1 : 0;
  const tickets: TicketValues[] = draft.mode === 'rsvp'
    ? [{ name: 'Free admission', priceCents: 0, quantity: cols.capacity ?? MAX_QUANTITY, min: 1, max: 10, salesStart: null, salesEnd: null, description: null, hidden: 0 }]
    : draft.tickets.map((t) => ticketValues(t, draft.timeZone, cols.capacity));
  const publish = tickets.length > 0 && fd.get('save_as') !== 'draft';
  const paid = tickets.some((t) => t.priceCents > 0);
  const status = !publish ? 'draft' : paid && !org.verified ? 'in_review' : 'published';
  const published = status === 'published';
  const r = await execute(
    `INSERT INTO events (organization_id, venue_id, online_url, slug, title, summary, description, image_path, video_url, starts_at, ends_at, show_end_time, doors_at, timezone, capacity, waitlist_enabled, status,
       visibility, private_key, access_password, age_restriction, fee_mode, tax_bps, tax_label, currency, refund_policy, refund_days_before, allow_transfers, category, featured, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`,
    [org.id, where.venueId, where.onlineUrl, slug, cols.title, cols.summary, cols.description, images.cover, cols.videoUrl, cols.startsAt, cols.endsAt, cols.showEnd, cols.doorsAt, cols.timezone,
      cols.capacity, cols.waitlist, status, cols.visibility, privateKey, cols.password, cols.age, cols.feeMode, cols.taxBps, cols.taxLabel,
      cols.refundPolicy, cols.refundDays, cols.allowTransfers, cols.category, featured, session.user.id],
  );
  const eventId = r.insertId;
  let sort = 0;
  for (const t of tickets) await insertTicket(eventId, t, sort++, session.user.id);
  await saveGallery(eventId, draft.galleryPost, images.photos, session.user.id);
  await audit('event.created', { actorUserId: session.user.id, targetType: 'event', targetId: eventId, metadata: { title: cols.title, viaCreatePage: true, status } });
  if (status === 'in_review') await audit('event.held_for_review', { actorUserId: session.user.id, targetType: 'event', targetId: eventId, metadata: { reason: 'paid_tickets_unverified_org' } });
  if (published) await audit('event.published', { actorUserId: session.user.id, targetType: 'event', targetId: eventId, metadata: { status: 'published' } });
  revalidateEventPages(org.slug, eventId, [slug]);

  return {
    ok: true,
    url: `${env.APP_URL}${publicEventPath({ slug, visibility: cols.visibility, private_key: privateKey })}`,
    manageUrl: `/org/${org.slug}/events/${eventId}`,
    editUrl: `/org/${org.slug}/events/${eventId}/edit`,
    published,
    inReview: status === 'in_review',
    verified: org.verified,
    payoutsNeeded: published && paid && !(await payoutsReady(org.id, org.verified)),
    passwordFor: (await needsPassword(session.user.id)) ? session.user.email : null,
    orgSlug: org.slug,
    // a new organizer answers the sign-up questionnaire on the way into the dashboard
    dashboardUrl: (await queryOne(
      `SELECT 1 FROM organizations g JOIN organization_members m ON m.organization_id = g.id AND m.user_id = ? AND m.role = 'org_admin' WHERE g.id = ? AND g.questionnaire_done_at IS NULL`,
      [session.user.id, org.id],
    )) ? `/org/${org.slug}/welcome` : `/org/${org.slug}/events/${eventId}`,
    orgName: org.name,
  };
}

// ---------------------------------------------------------------------------
// Editing an event on the same page (plan 5.6.12)
// ---------------------------------------------------------------------------
export async function saveEventEdits(_prev: CreateState, fd: FormData): Promise<CreateState> {
  const orgSlug = String(fd.get('org') ?? '').trim();
  const ctx = await assertOrg(orgSlug, 'organizer');
  const event: EventListRow | null = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) return { error: 'Event not found.' };
  if (event.status === 'cancelled') return { error: 'A cancelled event can’t be edited.' };

  const draft = readDraft(fd);
  if ('error' in draft) return draft;
  const original = String(fd.get('original_start') ?? '').split('T');
  const otherTickets = (await listTicketTypes(event.id)).filter((t) => !(t.kind === 'general' && !t.event_date_id && !t.access_code && Number(t.seats_per_unit) === 1)).length;
  const cols = await columnsFrom(draft, { startDate: original[0] ?? '', startTime: original[1] ?? '', otherTickets });
  if ('error' in cols) return cols;

  // web address: lower-case letters, numbers and dashes, and not another event's
  let slug = event.slug;
  if (draft.slug && draft.slug !== event.slug) {
    if (await queryOne(`SELECT 1 FROM events WHERE slug = ? AND id <> ?`, [draft.slug, event.id])) return { error: 'That web address is taken. Try another one.' };
    slug = draft.slug;
  }
  // the saved event password stays when the field was left as it was loaded
  const password = fd.get('password_unchanged') === '1' ? event.access_password : cols.password;
  const ticketPlan = draft.mode === 'tickets' ? await planTickets(event.id, draft.tickets, draft.timeZone, cols.capacity) : null;
  if (ticketPlan && 'error' in ticketPlan) return ticketPlan;

  const images = await uploadImages(fd, draft.galleryPost);
  if ('error' in images) return images;
  const where = await resolveLocation(draft, ctx.org.id, ctx.session.user.id);
  if ('error' in where) {
    for (const p of [images.cover, ...images.photos.values()]) await deleteUpload(p);
    return where;
  }
  const before = await eventSnapshot(event.id);

  // multi-day events take their dates from the Schedule tab
  const multiDay = (await listEventDates(event.id)).length > 0;
  let imagePath = event.image_path;
  const coverState = String(fd.get('cover_state') ?? 'keep');
  if (images.cover) imagePath = images.cover;
  else if (coverState === 'none') imagePath = null;

  if (ticketPlan) await applyTicketPlan(event.id, ticketPlan, ctx.session.user.id);
  const verified = !!ctx.org.verified_at;

  const privateKey = cols.visibility === 'private' ? (event.private_key ?? randomToken(12).slice(0, 16)) : null;
  await execute(
    `UPDATE events SET venue_id = ?, online_url = ?, slug = ?, title = ?, summary = ?, description = ?, image_path = ?, video_url = ?, starts_at = ?, ends_at = ?, show_end_time = ?, doors_at = ?, timezone = ?,
       capacity = ?, waitlist_enabled = ?, visibility = ?, private_key = ?, access_password = ?, age_restriction = ?, fee_mode = ?, tax_bps = ?, tax_label = ?, refund_policy = ?,
       refund_days_before = ?, allow_transfers = ?, category = ? WHERE id = ?`,
    [where.venueId, where.onlineUrl, slug, cols.title, cols.summary, cols.description, imagePath, cols.videoUrl,
      multiDay ? event.starts_at : cols.startsAt, multiDay ? event.ends_at : cols.endsAt, cols.showEnd, multiDay ? event.doors_at : cols.doorsAt, cols.timezone,
      cols.capacity, cols.waitlist, cols.visibility, privateKey, password, cols.age, cols.feeMode, cols.taxBps, cols.taxLabel, cols.refundPolicy,
      cols.refundDays, cols.allowTransfers, cols.category, event.id],
  );
  if (imagePath !== event.image_path) await deleteUpload(event.image_path);
  if (ctx.isSuperAdmin) await execute(`UPDATE events SET featured = ? WHERE id = ?`, [draft.featured ? 1 : 0, event.id]);
  await saveGallery(event.id, draft.galleryPost, images.photos, ctx.session.user.id);
  await audit('event.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { viaCreatePage: true } });

  // a draft can be published from the page, as from the dashboard
  let status = event.status;
  if (fd.get('save_as') === 'publish' && event.status === 'draft') {
    const tt = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ?`, [event.id]);
    if (Number(tt?.n ?? 0) > 0) {
      status = await liveStatus(event.id, verified);
      await execute(`UPDATE events SET status = ? WHERE id = ?`, [status, event.id]);
      await audit(status === 'published' ? 'event.published' : 'event.held_for_review', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { status } });
    }
  } else if (await holdIfUnverified(event.id, verified, ctx.session.user.id)) {
    // a paid ticket added to a live free event
    status = 'in_review';
  }
  const notified = await notifyEventChanged(before, ctx.session.user.id);
  revalidateEventPages(ctx.org.slug, event.id, [...new Set([event.slug, slug])]);

  return {
    ok: true,
    url: `${env.APP_URL}${publicEventPath({ slug, visibility: cols.visibility, private_key: privateKey })}`,
    manageUrl: `/org/${ctx.org.slug}/events/${event.id}`,
    editUrl: `/org/${ctx.org.slug}/events/${event.id}/edit`,
    published: status === 'published',
    inReview: status === 'in_review',
    verified,
    payoutsNeeded: false,
    passwordFor: null,
    orgSlug: ctx.org.slug,
    dashboardUrl: `/org/${ctx.org.slug}/events/${event.id}`,
    orgName: ctx.org.name,
    notified,
  };
}
