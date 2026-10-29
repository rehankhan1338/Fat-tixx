'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { PoolConnection } from 'mysql2/promise';
import { db, execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertPlatformRole } from '../auth/guard';
import { assertOrg, canAccessEvent } from '../authz';
import { getEvent } from '../events/queries';
import { parseDollarsToCents } from '../money';
import { orgIsPro } from '../pro/gate';
import { diffLayouts, expandLayout, parseLayout, seatCount, TIER_COLORS } from './layout';
import { createFeeCheckout, feeSettled } from './fee';
import { holdIfUnverified } from '../orgs/verification';
import { lockSeatsForChange, seatingInUse, syncSeatedQuantities } from './inventory';
import { getEventSeating, getSeatMap, getSeatMapRequest, mapLayout, mapUsableBy, type SeatMapRequestRow } from './queries';
import { addNote, createSeatMapRequest, ensureDraftMap, logMapChange, moveRequest, notifyOrganizer, notifyStaff } from './requests';

/*
 * Reserved seating actions (plan 5.7.3–5.7.13):
 *  - organizers: comment on, approve or send back a seat map request, pay its set-up fee, ask for a change to a map;
 *  - Fattixx staff (Support, Super Admin): build the map, move the request along, settle the fee, curate the library;
 *  - the event's Seating tab: use a map, create pricing tiers, assign / block seats, move a sold ticket to another seat.
 * New requests are created by the upload route (src/app/api/seating/requests/route.ts), which takes the floor plan.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const fail = (e: unknown): ActionState => ({ error: e instanceof Error ? e.message : 'Something went wrong.' });

function revalidateRequest(r: Pick<SeatMapRequestRow, 'id' | 'org_slug'>) {
  revalidatePath(`/org/${r.org_slug}/seating`);
  revalidatePath(`/org/${r.org_slug}/seating/${r.id}`);
  revalidatePath('/admin/seating');
  revalidatePath(`/admin/seating/${r.id}`);
}

// ---------------------------------------------------------------------------
// Organizer side of a request
// ---------------------------------------------------------------------------
async function orgRequest(fd: FormData) {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const r = await getSeatMapRequest(Number(fd.get('request_id')));
  if (!r || Number(r.organization_id) !== ctx.org.id) throw new Error('Request not found.');
  return { ctx, r };
}

export async function noteFromOrganizer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { ctx, r } = await orgRequest(fd);
    const body = str(fd, 'body', 10_000);
    if (body.length < 2) return { error: 'Write a message.' };
    await addNote(r.id, ctx.session.user.id, false, body);
    await audit('seatmap.request.noted', { actorUserId: ctx.session.user.id, targetType: 'seat_map_request', targetId: r.id, metadata: { staff: false } });
    await notifyStaff(r, 'New message from the organizer', body);
    revalidateRequest(r);
    return { ok: true, message: 'Sent to the Fattixx team.' };
  } catch (e) { return fail(e); }
}

/** The organizer signs off: the map becomes approved and usable for their events. */
export async function approveSeatMap(fd: FormData): Promise<ActionState> {
  try {
    const { ctx, r } = await orgRequest(fd);
    if (r.status !== 'awaiting_approval' || !r.seat_map_id) return { error: 'This map is not waiting for your approval.' };
    if (!feeSettled(r)) return { error: 'Pay the set-up fee first. The map can be used once it is paid.' };
    await moveRequest(r, 'approved', 'organizer', ctx.session.user.id, `Approved by ${ctx.session.user.name}.`);
    const mapId = Number(r.seat_map_id);
    await execute(`UPDATE seat_maps SET status = 'approved', approved_at = NOW(), approved_by = ? WHERE id = ?`, [ctx.session.user.id, mapId]);
    if (r.base_map_id) {
      // A change to an existing map replaces it: the new version takes its place in the library. Events that already
      // use the old version keep their own copy of its seats.
      await execute(`UPDATE seat_maps n JOIN seat_maps b ON b.id = n.based_on_id SET n.in_library = b.in_library WHERE n.id = ?`, [mapId]);
      await execute(`UPDATE seat_maps SET status = 'retired', in_library = 0 WHERE id = ? AND organization_id = ?`, [r.base_map_id, ctx.org.id]);
      await logMapChange(Number(r.base_map_id), ctx.session.user.id, 'retired', `Replaced by map #${mapId}`);
    }
    await logMapChange(mapId, ctx.session.user.id, 'approved', `Approved by ${ctx.session.user.name} (${ctx.org.name})`);
    await notifyStaff(r, 'Seat map approved', `${ctx.session.user.name} approved the map. It can now be used for events.`);
    revalidateRequest(r);
    return { ok: true, message: 'Approved. You can now use this map on the Seating tab of your events.' };
  } catch (e) { return fail(e); }
}

export async function sendBackSeatMap(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { ctx, r } = await orgRequest(fd);
    const body = str(fd, 'body', 10_000);
    if (body.length < 5) return { error: 'Tell us what to change (for example “Row C should start at seat 101”).' };
    if (r.status !== 'awaiting_approval') return { error: 'This map is not waiting for your approval.' };
    await moveRequest(r, 'in_progress', 'organizer', ctx.session.user.id, `Changes requested: ${body}`);
    await notifyStaff(r, 'Organizer asked for changes', body);
    revalidateRequest(r);
    return { ok: true, message: 'Sent back to the Fattixx team with your changes.' };
  } catch (e) { return fail(e); }
}

export async function cancelOwnRequest(fd: FormData): Promise<ActionState> {
  try {
    const { ctx, r } = await orgRequest(fd);
    if (r.status !== 'new') return { error: 'Work on this map has started. Message the Fattixx team to cancel it.' };
    await moveRequest(r, 'cancelled', 'organizer', ctx.session.user.id, `Cancelled by ${ctx.session.user.name}.${r.fee_status === 'paid' ? ' The set-up fee will be refunded by the Fattixx team.' : ''}`);
    await notifyStaff(r, 'Request cancelled by the organizer', r.fee_status === 'paid' ? 'The set-up fee was paid: refund it in Stripe.' : 'No fee was paid.');
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Stripe Checkout for the set-up fee. */
export async function payFee(fd: FormData): Promise<ActionState> {
  let url: string;
  try {
    const { ctx, r } = await orgRequest(fd);
    if (r.status === 'cancelled') return { error: 'This request was cancelled.' };
    if (feeSettled(r)) return { error: 'The set-up fee is already settled.' };
    url = await createFeeCheckout(r, ctx.session.user.email);
  } catch (e) { return fail(e); }
  redirect(url);
}

/** Ask Fattixx to change one of the organization's approved maps (no set-up fee). */
export async function requestMapChange(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
    if (!orgIsPro(ctx.org)) return { error: 'Reserved seating is part of Fattixx Pro.' };
    const map = await getSeatMap(Number(fd.get('map_id')));
    if (!map || Number(map.organization_id) !== ctx.org.id || map.status !== 'approved') return { error: 'Map not found.' };
    const open = await queryOne<Row & { id: number }>(`SELECT id FROM seat_map_requests WHERE base_map_id = ? AND status IN ('new','in_progress','awaiting_approval')`, [map.id]);
    if (open) return { error: 'A change to this map is already in progress.' };
    const notes = str(fd, 'body', 5000);
    if (notes.length < 5) return { error: 'Describe what should change.' };
    const r = await createSeatMapRequest({
      organizationId: ctx.org.id, userId: ctx.session.user.id, venueId: map.venue_id, venueName: map.venue_name, venueCity: map.venue_city,
      mapName: map.name, notes, floorPlan: null, baseMapId: Number(map.id),
    });
    target = `/org/${ctx.org.slug}/seating/${r.id}`;
  } catch (e) { return fail(e); }
  redirect(target);
}

// ---------------------------------------------------------------------------
// Staff side (Admin → Seat maps)
// ---------------------------------------------------------------------------
async function staffRequest(fd: FormData) {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const r = await getSeatMapRequest(Number(fd.get('request_id')));
  if (!r) throw new Error('Request not found.');
  return { session, r };
}

/** Pick the request up: it moves to In progress, is assigned to you, and gets its draft map. */
export async function staffStartRequest(fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    if (r.status === 'new') await moveRequest(r, 'in_progress', 'staff', session.user.id, `${session.user.name} started building the map.`);
    else if (r.status !== 'in_progress') return { error: 'Only new or in-progress requests can be worked on.' };
    await execute(`UPDATE seat_map_requests SET assigned_to = COALESCE(assigned_to, ?) WHERE id = ?`, [session.user.id, r.id]);
    await ensureDraftMap((await getSeatMapRequest(r.id))!, session.user.id);
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function staffAssign(fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    const to = str(fd, 'to', 10) === 'none' ? null : session.user.id;
    await execute(`UPDATE seat_map_requests SET assigned_to = ? WHERE id = ?`, [to, r.id]);
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

async function editableMap(r: SeatMapRequestRow) {
  if (r.status !== 'in_progress') throw new Error(r.status === 'awaiting_approval' ? 'The map is with the organizer for approval. Take it back to make changes.' : 'Start work on the request first.');
  const map = r.seat_map_id ? await getSeatMap(Number(r.seat_map_id)) : null;
  if (!map || map.status !== 'draft') throw new Error('This map can no longer be edited.');
  return map;
}

/** Save the builder: validate, write the readable change list to the map's history, store. */
export type SaveState = { error?: string; ok?: boolean; message?: string; saved?: number } | undefined;

export async function saveSeatMapLayout(_prev: SaveState, fd: FormData): Promise<SaveState> {
  try {
    const { session, r } = await staffRequest(fd);
    const map = await editableMap(r);
    let raw: unknown;
    try { raw = JSON.parse(str(fd, 'layout', 900_000)); } catch { return { error: 'The layout could not be read. Reload the page.' }; }
    const parsed = parseLayout(raw);
    if ('error' in parsed) return { error: parsed.error };
    const before = mapLayout(map);
    const lines = diffLayouts(before, parsed.layout);
    if (!lines.length) return { ok: true, message: 'No changes to save.' };
    const seats = seatCount(parsed.layout);
    const name = str(fd, 'name', 160);
    await execute(`UPDATE seat_maps SET layout = ?, seat_count = ?, name = IF(? = '', name, ?) WHERE id = ? AND status = 'draft'`, [JSON.stringify(parsed.layout), seats, name, name, map.id]);
    await logMapChange(Number(map.id), session.user.id, 'saved', `${lines.length} change${lines.length === 1 ? '' : 's'} · ${seats} seats`, lines);
    await audit('seatmap.saved', { actorUserId: session.user.id, targetType: 'seat_map', targetId: map.id, metadata: { changes: lines.length, seats } });
    revalidateRequest(r);
    return { ok: true, message: `Saved: ${lines.length} change${lines.length === 1 ? '' : 's'}, ${seats} seats.`, saved: Date.now() };
  } catch (e) { return fail(e); }
}

/** Replace the draft with a copy of another approved map (e.g. the same venue in another layout). */
export async function staffCopyLayout(fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    const map = await editableMap(r);
    const from = await getSeatMap(Number(fd.get('from_map_id')));
    if (!from || from.status !== 'approved') return { error: 'Choose an approved map to copy.' };
    const layout = mapLayout(from);
    const lines = diffLayouts(mapLayout(map), layout);
    await execute(`UPDATE seat_maps SET layout = ?, seat_count = ? WHERE id = ?`, [JSON.stringify(layout), seatCount(layout), map.id]);
    await logMapChange(Number(map.id), session.user.id, 'copied', `Copied the layout of “${from.name}” (#${from.id})`, lines);
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function staffSendForApproval(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    const map = await editableMap(r);
    if (!Number(map.seat_count)) return { error: 'The map has no seats yet.' };
    const message = str(fd, 'body', 5000);
    const next = await moveRequest(r, 'awaiting_approval', 'staff', session.user.id, `Sent to the organizer for approval (${map.seat_count} seats).${message ? ` ${message}` : ''}`);
    await notifyOrganizer(next, 'Your seat map is ready to approve',
      `${message ? `${message}\n\n` : ''}Check every section, row and seat number, then approve it to start selling reserved seats.${feeSettled(next) ? '' : ' The set-up fee is due before the map can be used.'}`);
    revalidateRequest(r);
    return { ok: true, message: 'Sent to the organizer.' };
  } catch (e) { return fail(e); }
}

export async function staffTakeBack(fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    await moveRequest(r, 'in_progress', 'staff', session.user.id, `${session.user.name} took the map back to make changes.`);
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function staffCancel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    const reason = str(fd, 'body', 2000);
    if (reason.length < 5) return { error: 'Give the organizer a reason.' };
    const next = await moveRequest(r, 'cancelled', 'staff', session.user.id, `Cancelled: ${reason}`);
    await notifyOrganizer(next, 'Your seat map request was cancelled', reason);
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function noteFromStaff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    const body = str(fd, 'body', 10_000);
    if (body.length < 2) return { error: 'Write a message.' };
    await addNote(r.id, session.user.id, true, body);
    await audit('seatmap.request.noted', { actorUserId: session.user.id, targetType: 'seat_map_request', targetId: r.id, metadata: { staff: true } });
    await notifyOrganizer(r, 'New message about your seat map', body);
    revalidateRequest(r);
    return { ok: true, message: 'Sent to the organizer.' };
  } catch (e) { return fail(e); }
}

/** Fee settled outside Stripe Checkout (invoice, bank transfer) or waived; or reset to unpaid. */
export async function staffSetFee(fd: FormData): Promise<ActionState> {
  try {
    const { session, r } = await staffRequest(fd);
    const status = str(fd, 'fee_status', 10);
    if (!['paid', 'waived', 'unpaid'].includes(status)) return { error: 'Choose a fee status.' };
    await execute(`UPDATE seat_map_requests SET fee_status = ?, fee_paid_at = IF(? = 'paid', COALESCE(fee_paid_at, NOW()), NULL) WHERE id = ?`, [status, status, r.id]);
    await addNote(r.id, session.user.id, true, `Set-up fee marked ${status} by ${session.user.name}.`);
    await audit('seatmap.request.fee', { actorUserId: session.user.id, targetType: 'seat_map_request', targetId: r.id, metadata: { status, via: 'staff' } });
    revalidateRequest(r);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** List an approved map in the Venue Library (usable by every Pro organizer), or take it out. */
export async function staffSetLibrary(fd: FormData): Promise<ActionState> {
  try {
    const session = await assertPlatformRole(['super_admin', 'support']);
    const map = await getSeatMap(Number(fd.get('map_id')));
    if (!map || map.status !== 'approved') return { error: 'Only approved maps can be listed.' };
    const listed = str(fd, 'listed', 1) === '1';
    await execute(`UPDATE seat_maps SET in_library = ? WHERE id = ?`, [listed ? 1 : 0, map.id]);
    await logMapChange(Number(map.id), session.user.id, 'library', listed ? 'Listed in the Venue Library' : 'Taken out of the Venue Library');
    await audit('seatmap.library.updated', { actorUserId: session.user.id, targetType: 'seat_map', targetId: map.id, metadata: { listed } });
    revalidatePath('/admin/seating');
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// The event's Seating tab
// ---------------------------------------------------------------------------
async function eventForSeating(fd: FormData) {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found');
  return { ctx, event };
}

function revalidateSeating(orgSlug: string, event: { id: number; slug: string }) {
  revalidatePath(`/org/${orgSlug}/events/${event.id}`);
  revalidatePath(`/events/${event.slug}`);
}

async function inTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Use an approved map for this event: the event gets its own copy of every seat, none for sale until priced. */
export async function attachSeatMap(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { ctx, event } = await eventForSeating(fd);
    if (!orgIsPro(ctx.org)) return { error: 'Reserved seating is part of Fattixx Pro.' };
    if (event.status === 'cancelled' || event.status === 'completed') return { error: `This event is ${event.status}.` };
    const map = await getSeatMap(Number(fd.get('map_id')));
    if (!map || !mapUsableBy(map, ctx.org.id)) return { error: 'Choose one of your approved maps or a map from the Venue Library.' };
    if (await getEventSeating(event.id)) return { error: 'This event already has a seat map. Remove it first to use another one.' };
    const layout = mapLayout(map);
    const seats = expandLayout(layout);
    if (!seats.length) return { error: 'This map has no seats.' };
    await inTransaction(async (conn) => {
      await conn.query(`INSERT INTO event_seating (event_id, seat_map_id, layout, attached_by) VALUES (?, ?, ?, ?)`, [event.id, map.id, JSON.stringify(layout), ctx.session.user.id]);
      for (let i = 0; i < seats.length; i += 500) {
        const chunk = seats.slice(i, i + 500);
        await conn.query(
          `INSERT INTO event_seats (event_id, seat_key, section, row_label, seat_number, label, x, y, accessibility, sort_order) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          chunk.flatMap((s) => [event.id, s.key, s.section.slice(0, 80), s.row, s.number, s.label, s.x, s.y, s.access ?? 'none', s.sort]),
        );
      }
    });
    await audit('seating.attached', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { map: map.id, seats: seats.length } });
    revalidateSeating(ctx.org.slug, event);
    return { ok: true, message: `${seats.length} seats added. Create pricing tiers and assign seats to them to start selling.` };
  } catch (e) { return fail(e); }
}

/** Remove the map from the event. Only while no seat is sold or in someone's cart. */
export async function detachSeatMap(fd: FormData): Promise<ActionState> {
  try {
    const { ctx, event } = await eventForSeating(fd);
    const use = await seatingInUse(event.id);
    if (use.sold || use.held) return { error: `${use.sold} seat${use.sold === 1 ? ' is' : 's are'} sold and ${use.held} in a buyer’s cart. Once seats are sold the map stays; you can still block seats or change unsold ones.` };
    await inTransaction(async (conn) => {
      await conn.query(`DELETE FROM event_seats WHERE event_id = ?`, [event.id]);
      await conn.query(`DELETE FROM event_seating WHERE event_id = ?`, [event.id]);
      await conn.query(`UPDATE ticket_types SET quantity = sold WHERE event_id = ? AND seated = 1`, [event.id]);
    });
    await audit('seating.detached', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id });
    revalidateSeating(ctx.org.slug, event);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** A pricing tier is a ticket type sold seat by seat; its other settings (sales window, limits, codes) are on the Ticket types tab. */
export async function createSeatTier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { ctx, event } = await eventForSeating(fd);
    if (!(await getEventSeating(event.id))) return { error: 'Choose a seat map first.' };
    const name = str(fd, 'name', 120);
    if (name.length < 2) return { error: 'Name the tier, e.g. Orchestra or Balcony.' };
    const price = parseDollarsToCents(str(fd, 'price', 12) || '0');
    if (price === null) return { error: 'Enter a valid price, e.g. 45.00.' };
    const count = await queryOne<Row & { n: number; sort: number | null }>(`SELECT SUM(seated) AS n, MAX(sort_order) AS sort FROM ticket_types WHERE event_id = ?`, [event.id]);
    const color = /^#[0-9a-f]{6}$/i.test(str(fd, 'color', 7)) ? str(fd, 'color', 7) : TIER_COLORS[Number(count?.n ?? 0) % TIER_COLORS.length];
    const r = await execute(
      `INSERT INTO ticket_types (event_id, name, kind, price_cents, quantity, min_per_order, max_per_order, seats_per_unit, seated, seat_color, sort_order)
       VALUES (?, ?, 'general', ?, 0, 1, 10, 1, 1, ?, ?)`,
      [event.id, name, price, color, Number(count?.sort ?? -1) + 1],
    );
    await audit('seating.tier.created', { actorUserId: ctx.session.user.id, targetType: 'ticket_type', targetId: r.insertId, metadata: { eventId: event.id, price } });
    const held = await holdIfUnverified(event.id, !!ctx.org.verified_at, ctx.session.user.id);
    revalidateSeating(ctx.org.slug, event);
    return { ok: true, message: `${name} created. Select seats on the map and assign them to it.${held ? ' Paid tickets need a verified organization, so the event is in review and hidden until then.' : ''}` };
  } catch (e) { return fail(e); }
}

export async function updateTierColor(fd: FormData): Promise<ActionState> {
  try {
    const { ctx, event } = await eventForSeating(fd);
    const color = str(fd, 'color', 7);
    if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: 'Choose a colour.' };
    await execute(`UPDATE ticket_types SET seat_color = ? WHERE id = ? AND event_id = ? AND seated = 1`, [color, Number(fd.get('tier_id')), event.id]);
    revalidateSeating(ctx.org.slug, event);
    return { ok: true };
  } catch (e) { return fail(e); }
}

const SEAT_OPS = { assign: 'Assigned', unassign: 'Took off sale', block: 'Blocked', unblock: 'Unblocked' } as const;

/**
 * Change the selected seats: assign them to a tier, take them off sale, block or unblock them. Sold seats and seats in
 * a buyer's cart are never changed (the rule for seats once they are sold); the message says how many were skipped.
 */
export async function updateEventSeats(fd: FormData): Promise<ActionState> {
  try {
    const { ctx, event } = await eventForSeating(fd);
    const op = str(fd, 'op', 10) as keyof typeof SEAT_OPS;
    if (!(op in SEAT_OPS)) return { error: 'Choose what to do with the seats.' };
    const ids = [...new Set(str(fd, 'seat_ids', 400_000).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20_000);
    if (!ids.length) return { error: 'Select seats on the map first.' };
    let tierName = '';
    let tierId: number | null = null;
    if (op === 'assign') {
      const tier = await queryOne<Row & { id: number; name: string }>(`SELECT id, name FROM ticket_types WHERE id = ? AND event_id = ? AND seated = 1`, [Number(fd.get('tier_id')), event.id]);
      if (!tier) return { error: 'Choose a pricing tier.' };
      tierId = Number(tier.id); tierName = tier.name;
    }
    const reason = str(fd, 'reason', 120) || null;
    const { changed, skipped } = await inTransaction(async (conn) => {
      let changed = 0, skipped = 0;
      for (let i = 0; i < ids.length; i += 1000) {
        const { free, taken } = await lockSeatsForChange(conn, event.id, ids.slice(i, i + 1000));
        skipped += taken.length;
        if (!free.length) continue;
        const set = op === 'assign' ? 'ticket_type_id = ?' : op === 'unassign' ? 'ticket_type_id = NULL' : op === 'block' ? 'blocked = 1, block_reason = ?' : 'blocked = 0, block_reason = NULL';
        const args = op === 'assign' ? [tierId] : op === 'block' ? [reason] : [];
        await conn.query(`UPDATE event_seats SET ${set} WHERE id IN (${free.map(() => '?').join(',')})`, [...args, ...free.map((s) => s.id)]);
        changed += free.length;
      }
      return { changed, skipped };
    });
    await syncSeatedQuantities(event.id);
    await audit('seating.seats.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { op, tier: tierId, changed, skipped, reason } });
    revalidateSeating(ctx.org.slug, event);
    const what = `${SEAT_OPS[op]} ${changed} seat${changed === 1 ? '' : 's'}${op === 'assign' ? ` to ${tierName}` : ''}.`;
    return { ok: true, message: skipped ? `${what} ${skipped} sold or held seat${skipped === 1 ? ' was' : 's were'} left as ${skipped === 1 ? 'it was' : 'they were'}.` : what };
  } catch (e) { return fail(e); }
}

/** Move a sold ticket to another free seat of the same tier (same price paid). The ticket keeps its QR code. */
export async function moveTicketSeat(fd: FormData): Promise<ActionState> {
  try {
    const { ctx, event } = await eventForSeating(fd);
    const ticketId = Number(fd.get('ticket_id')), seatId = Number(fd.get('seat_id'));
    const moved = await inTransaction(async (conn) => {
      const [[t]] = await conn.query<(Row & { id: number; code: string; status: string; ticket_type_id: number; event_seat_id: number | null; seat_label: string | null })[]>(
        `SELECT id, code, status, ticket_type_id, event_seat_id, seat_label FROM tickets WHERE id = ? AND event_id = ? FOR UPDATE`, [ticketId, event.id],
      );
      if (!t || !t.event_seat_id || !['valid', 'used'].includes(t.status)) throw new Error('Choose a sold seat to move.');
      const { free } = await lockSeatsForChange(conn, event.id, [seatId]);
      const to = free[0];
      if (!to || to.blocked || !to.ticket_type_id) throw new Error('The new seat must be free and for sale.');
      if (Number(to.ticket_type_id) !== Number(t.ticket_type_id)) throw new Error('Move tickets only to a seat of the same pricing tier, so the price paid still matches.');
      await conn.query(`UPDATE tickets SET event_seat_id = ?, seat_label = ? WHERE id = ?`, [to.id, to.label, t.id]);
      return { code: t.code, from: t.seat_label, to: to.label };
    });
    await audit('seating.ticket.moved', { actorUserId: ctx.session.user.id, targetType: 'ticket', targetId: ticketId, metadata: { eventId: event.id, ...moved } });
    revalidateSeating(ctx.org.slug, event);
    return { ok: true, message: `Ticket ${moved.code} moved from ${moved.from} to ${moved.to}. Its QR code is unchanged; the ticket page shows the new seat.` };
  } catch (e) { return fail(e); }
}
