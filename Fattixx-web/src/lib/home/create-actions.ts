'use server';

/*
 * Saves the event drafted on /create under the signed-in organizer's organization, with its venue, cover image and ticket
 * types. Organizations verified by Fattixx get the event published at once; otherwise it stays a draft until the
 * organizer publishes it from the dashboard. Visitors without an organization apply to sell tickets first (/sell).
 */

import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { getSession } from '../auth/session';
import { listMemberships } from '../authz';
import { execute, queryOne, type Row } from '../db';
import { env } from '../env';
import { publicEventPath } from '../events/queries';
import { rateLimited } from '../security/bot';
import { randomToken } from '../security/crypto';
import { shortSuffix, slugify } from '../slug';
import { isValidTimeZone, wallClockToUtc } from '../tz';
import { saveImageUpload } from '../uploads';
import { categoryNames } from '../site-content/categories';
import { checkDraft, parseDraftForServer, type EventDraft } from './create';
import { parseDollars } from './pricing';

export type CreateState =
  | { error: string; needsAuth?: boolean }
  | { ok: true; url: string; manageUrl: string; published: boolean; verified: boolean; orgName: string }
  | undefined;

const MAX_QUANTITY = 1_000_000;

export async function publishDraft(_prev: CreateState, fd: FormData): Promise<CreateState> {
  const session = await getSession();
  if (!session) return { error: 'Sign in to create your event. Your draft stays in this browser.', needsAuth: true };
  if (rateLimited(`create:${session.user.id}`, 20, 10 * 60_000)) return { error: 'Too many events created in a short time. Please try again later.' };

  let draft: EventDraft;
  try {
    draft = parseDraftForServer(String(fd.get('draft') ?? ''));
  } catch {
    return { error: 'The event details could not be read. Reload the page and try again.' };
  }
  const problems = checkDraft(draft);
  if (problems.length) return { error: problems[0].message };
  if (!(await categoryNames()).includes(draft.category)) return { error: 'Pick a category from the list.' };
  if (!isValidTimeZone(draft.timeZone)) return { error: 'Choose a valid time zone.' };

  // --- which organization hosts it ---
  const memberships = (await listMemberships(session.user.id)).filter((m) => m.status === 'active' && m.role !== 'staff');
  const wanted = String(fd.get('org') ?? '').trim();
  let org: { id: number; slug: string; name: string; verified: boolean } | null = null;
  const m = (wanted && memberships.find((x) => x.slug === wanted)) || (memberships.length === 1 ? memberships[0] : null);
  if (m) {
    const row = await queryOne<Row & { verified_at: Date | null }>(`SELECT verified_at FROM organizations WHERE id = ?`, [m.organization_id]);
    org = { id: Number(m.organization_id), slug: m.slug, name: m.name, verified: !!row?.verified_at };
  } else if (wanted && session.user.roles.includes('super_admin')) {
    // Super Admin: "New event" from any organization's dashboard, member or not
    const row = await queryOne<Row & { id: number; slug: string; name: string; verified_at: Date | null }>(`SELECT id, slug, name, verified_at FROM organizations WHERE slug = ? AND status = 'active'`, [wanted]);
    if (!row) return { error: 'Organization not found.' };
    org = { id: Number(row.id), slug: row.slug, name: row.name, verified: !!row.verified_at };
  } else if (memberships.length) {
    return { error: 'Choose which organization hosts this event.' };
  } else {
    return { error: 'Events are created by approved organizers. Apply to sell tickets first.' };
  }

  // --- venue: one saved under the organization (Dashboard → Venues), or a new one from the address typed ---
  let venueId: number | null = null;
  if (draft.location.kind === 'saved') {
    const v = await queryOne<Row & { id: number }>(`SELECT id FROM venues WHERE id = ? AND organization_id = ?`, [Number(draft.location.venueId), org.id]);
    if (!v) return { error: 'Choose a venue from the list.' };
    venueId = Number(v.id);
  } else if (draft.location.kind === 'venue') {
    const l = draft.location;
    const name = (l.venueName || l.address || l.city).trim().slice(0, 160);
    const r = await execute(
      `INSERT INTO venues (organization_id, name, address_line1, city, region, timezone) VALUES (?, ?, ?, ?, ?, ?)`,
      [org.id, name, l.address.trim().slice(0, 200) || null, l.city.trim().slice(0, 120) || null, l.region.trim().slice(0, 120) || null, draft.timeZone],
    );
    venueId = r.insertId;
    await audit('venue.created', { actorUserId: session.user.id, targetType: 'venue', targetId: venueId, metadata: { name } });
  }

  // --- the event ---
  const startsAt = wallClockToUtc(`${draft.startDate}T${draft.startTime}`, draft.timeZone);
  const endsAt = draft.endDate && draft.endTime ? wallClockToUtc(`${draft.endDate}T${draft.endTime}`, draft.timeZone) : null;
  if (!startsAt) return { error: 'Enter the start date and time.' };
  const doorsAt = draft.doorsTime ? wallClockToUtc(`${draft.startDate}T${draft.doorsTime}`, draft.timeZone) : null;
  let slug = slugify(draft.name, 100);
  if (await queryOne(`SELECT 1 FROM events WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;
  let imagePath: string | null = null;
  const cover = fd.get('cover');
  if (cover instanceof File && cover.size > 0) {
    try {
      imagePath = await saveImageUpload(cover, 'events');
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  const capacity = draft.capacity ? Math.min(MAX_QUANTITY, Math.max(1, Number(draft.capacity))) : null;
  // the same rules the dashboard's event form stores (see eventFields in src/lib/events/actions.ts)
  const refund: [string, number | null] = draft.refund === 'days_before' ? ['days_before', Number(draft.refundDays)] : draft.refund === 'until_start' ? ['until_event_start', null] : ['no_refunds', null];
  const taxBps = draft.taxPct.trim() === '' ? null : Math.round(Number(draft.taxPct) * 100);
  if (taxBps !== null && (!Number.isFinite(taxBps) || taxBps < 0 || taxBps > 3000)) return { error: 'Tax must be between 0 and 30 percent, or blank to use the venue rate.' };
  const taxLabel = draft.taxLabel.trim().slice(0, 80) || null;
  const visibility = draft.visibility === 'unlisted' || draft.visibility === 'private' ? draft.visibility : 'public';
  const privateKey = visibility === 'private' ? randomToken(12).slice(0, 16) : null;
  const featured = draft.featured && session.user.roles.includes('super_admin') ? 1 : 0;
  const tickets = draft.mode === 'rsvp'
    ? [{ name: 'Free admission', priceCents: 0, quantity: capacity ?? MAX_QUANTITY, min: 1, max: 10, salesStart: null, salesEnd: null, description: null, hidden: 0 }]
    : draft.tickets.map((t) => ({
        name: t.name.trim().slice(0, 120),
        priceCents: parseDollars(t.price),
        quantity: t.quantity ? Math.min(MAX_QUANTITY, Math.max(1, Number(t.quantity))) : capacity ?? MAX_QUANTITY,
        min: Math.max(1, Number(t.minPerOrder) || 1),
        max: Math.max(1, Number(t.maxPerOrder) || 10),
        salesStart: t.salesStart ? wallClockToUtc(t.salesStart, draft.timeZone) : null,
        salesEnd: t.salesEnd ? wallClockToUtc(t.salesEnd, draft.timeZone) : null,
        description: t.description.trim().slice(0, 500) || null,
        hidden: t.hidden ? 1 : 0,
      }));
  const published = org.verified && tickets.length > 0 && fd.get('draft') !== '1';
  const r = await execute(
    `INSERT INTO events (organization_id, venue_id, slug, title, summary, description, image_path, starts_at, ends_at, doors_at, timezone, capacity, waitlist_enabled, status, visibility, private_key,
       age_restriction, fee_mode, tax_bps, tax_label, currency, refund_policy, refund_days_before, allow_transfers, category, featured, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)`,
    [org.id, venueId, slug, draft.name.trim().slice(0, 200), draft.summary.trim().slice(0, 300) || null, draft.description.trim().slice(0, 20000) || null, imagePath, startsAt, endsAt, doorsAt, draft.timeZone,
      capacity, draft.waitlist ? 1 : 0, published ? 'published' : 'draft', visibility, privateKey,
      draft.age === 'all' ? null : Number(draft.age), draft.feePayer === 'buyer' ? 'buyer_pays' : 'organizer_absorbs', taxBps, taxLabel, refund[0], refund[1], draft.allowTransfers ? 1 : 0, draft.category, featured, session.user.id],
  );
  const eventId = r.insertId;
  let sort = 0;
  for (const t of tickets) {
    const tt = await execute(
      `INSERT INTO ticket_types (event_id, name, description, kind, price_cents, quantity, min_per_order, max_per_order, seats_per_unit, sales_start_at, sales_end_at, hidden, sort_order)
       VALUES (?, ?, ?, 'general', ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [eventId, t.name, t.description, t.priceCents, t.quantity, t.min, Math.max(t.min, t.max), t.salesStart, t.salesEnd, t.hidden, sort++],
    );
    await audit('ticket_type.created', { actorUserId: session.user.id, targetType: 'ticket_type', targetId: tt.insertId, metadata: { eventId } });
  }
  await audit('event.created', { actorUserId: session.user.id, targetType: 'event', targetId: eventId, metadata: { title: draft.name, viaCreatePage: true, published } });
  if (published) await audit('event.published', { actorUserId: session.user.id, targetType: 'event', targetId: eventId, metadata: { status: 'published' } });
  revalidatePath('/');
  revalidatePath('/events');
  revalidatePath(`/org/${org.slug}/events`);

  return {
    ok: true,
    url: `${env.APP_URL}${publicEventPath({ slug, visibility, private_key: privateKey })}`,
    manageUrl: `/org/${org.slug}/events/${eventId}`,
    published,
    verified: org.verified,
    orgName: org.name,
  };
}
