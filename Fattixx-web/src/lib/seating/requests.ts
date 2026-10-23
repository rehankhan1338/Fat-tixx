import 'server-only';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { orgAdminRecipients } from '../pro/subscription';
import { emptyLayout, type SeatMapLayout } from './layout';
import { getSeatMapRequest, mapLayout, getSeatMap, REQUEST_STATUS_LABEL, setupFeeCents, type RequestStatus, type SeatMapRequestRow } from './queries';

/*
 * The "request a seat map" workflow (plan 5.7.3–5.7.13):
 *   new → in_progress → awaiting_approval → approved, or cancelled; the organizer can send an awaiting map back.
 * Every status change is written to the request's notes, so both sides see the same history. Helpers only: the
 * permission checks live in the actions (src/lib/seating/actions.ts) and the upload route.
 */

/** Which status changes are allowed, and by whom. */
export const TRANSITIONS: Record<RequestStatus, { to: RequestStatus; by: 'staff' | 'organizer' }[]> = {
  new: [{ to: 'in_progress', by: 'staff' }, { to: 'cancelled', by: 'staff' }, { to: 'cancelled', by: 'organizer' }],
  in_progress: [{ to: 'awaiting_approval', by: 'staff' }, { to: 'cancelled', by: 'staff' }],
  awaiting_approval: [{ to: 'approved', by: 'organizer' }, { to: 'in_progress', by: 'organizer' }, { to: 'in_progress', by: 'staff' }],
  approved: [],
  cancelled: [],
};

export function canMove(from: RequestStatus, to: RequestStatus, by: 'staff' | 'organizer'): boolean {
  return TRANSITIONS[from].some((t) => t.to === to && t.by === by);
}

const venueLine = (r: Pick<SeatMapRequestRow, 'venue_name' | 'venue_city'>) => [r.venue_name, r.venue_city].filter(Boolean).join(', ');

async function staffRecipients(assignedTo: number | null): Promise<{ email: string; name: string }[]> {
  // The assigned staff member if there is one, otherwise everyone who works the queue.
  if (assignedTo) {
    const a = await queryOne<Row & { email: string; name: string }>(`SELECT email, name FROM users WHERE id = ? AND status = 'active'`, [assignedTo]);
    if (a) return [a];
  }
  return query<Row & { email: string; name: string }>(
    `SELECT DISTINCT u.email, u.name FROM users u JOIN user_platform_roles r ON r.user_id = u.id WHERE r.role IN ('support','super_admin') AND u.status = 'active'`,
  );
}

export async function notifyStaff(r: SeatMapRequestRow, headline: string, message: string): Promise<void> {
  try {
    const mail = await renderEmail('seatmap_staff', { headline, org_name: r.org_name, map_name: r.map_name, venue: venueLine(r), message: message.slice(0, 3000), url: `${env.ADMIN_URL}/admin/seating/${r.id}` });
    for (const s of await staffRecipients(r.assigned_to ? Number(r.assigned_to) : null)) {
      await sendEmail({ to: s.email, toName: s.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'seat_map_request', id: r.id } });
    }
  } catch (e) { console.error('[seating] staff email failed', e); }
}

export async function notifyOrganizer(r: SeatMapRequestRow, headline: string, message: string): Promise<void> {
  try {
    const mail = await renderEmail('seatmap_organizer', { headline, map_name: r.map_name, venue: venueLine(r), message: message.slice(0, 3000), url: `${env.APP_URL}/org/${r.org_slug}/seating/${r.id}` });
    const to = new Map<string, string | null>();
    if (r.creator_email) to.set(r.creator_email.toLowerCase(), r.creator_name);
    for (const a of await orgAdminRecipients(Number(r.organization_id))) to.set(a.email.toLowerCase(), a.name);
    for (const [email, name] of to) await sendEmail({ to: email, toName: name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'seat_map_request', id: r.id } });
  } catch (e) { console.error('[seating] organizer email failed', e); }
}

export async function addNote(requestId: number, userId: number | null, fromStaff: boolean, body: string, statusTo: RequestStatus | null = null): Promise<void> {
  await execute(`INSERT INTO seat_map_request_notes (request_id, author_user_id, from_staff, status_to, body) VALUES (?, ?, ?, ?, ?)`, [requestId, userId, fromStaff ? 1 : 0, statusTo, body.slice(0, 10_000)]);
}

/** Move a request to a new status (checked against TRANSITIONS) and record it. Returns the updated row. */
export async function moveRequest(r: SeatMapRequestRow, to: RequestStatus, by: 'staff' | 'organizer', userId: number, note: string): Promise<SeatMapRequestRow> {
  if (!canMove(r.status, to, by)) throw new Error(`A request that is ${REQUEST_STATUS_LABEL[r.status].toLowerCase()} cannot move to ${REQUEST_STATUS_LABEL[to].toLowerCase()}.`);
  const res = await execute(
    `UPDATE seat_map_requests SET status = ?, sent_for_approval_at = IF(? = 'awaiting_approval', NOW(), sent_for_approval_at),
       approved_at = IF(? = 'approved', NOW(), approved_at), approved_by = IF(? = 'approved', ?, approved_by) WHERE id = ? AND status = ?`,
    [to, to, to, to, userId, r.id, r.status],
  );
  if (!res.affectedRows) throw new Error('The request was changed by someone else. Reload the page.');
  await addNote(r.id, userId, by === 'staff', note, to);
  await audit('seatmap.request.status', { actorUserId: userId, targetType: 'seat_map_request', targetId: r.id, metadata: { from: r.status, to, by } });
  return (await getSeatMapRequest(r.id))!;
}

/** Log one entry of a map's change history. */
export async function logMapChange(mapId: number, userId: number | null, action: string, summary: string, lines: string[] = []): Promise<void> {
  await execute(`INSERT INTO seat_map_changes (seat_map_id, user_id, action, summary, detail) VALUES (?, ?, ?, ?, ?)`, [mapId, userId, action, summary.slice(0, 500), lines.length ? JSON.stringify(lines.slice(0, 500)) : null]);
}

/** The draft map staff build for a request: a copy of the map being changed, or an empty canvas. */
export async function ensureDraftMap(r: SeatMapRequestRow, userId: number): Promise<number> {
  if (r.seat_map_id) return Number(r.seat_map_id);
  const base = r.base_map_id ? await getSeatMap(Number(r.base_map_id)) : null;
  const layout: SeatMapLayout = base ? mapLayout(base) : emptyLayout();
  const ins = await execute(
    `INSERT INTO seat_maps (organization_id, venue_id, name, venue_name, venue_city, venue_region, status, layout, seat_count, based_on_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [r.organization_id, r.venue_id, r.map_name, r.venue_name, r.venue_city, base?.venue_region ?? null, JSON.stringify(layout), base ? Number(base.seat_count) : 0, base?.id ?? null, userId],
  );
  await execute(`UPDATE seat_map_requests SET seat_map_id = ? WHERE id = ?`, [ins.insertId, r.id]);
  await logMapChange(ins.insertId, userId, 'created', base ? `Started from “${base.name}” (#${base.id}, ${base.seat_count} seats)` : 'Started an empty map');
  return ins.insertId;
}

export type NewRequestInput = {
  organizationId: number; userId: number; venueId: number | null; venueName: string; venueCity: string | null; mapName: string; notes: string | null;
  floorPlan: { path: string; kind: 'image' | 'pdf' } | null; baseMapId: number | null;
};

/** A new request. Changes to an organization's own approved map are free; a new map carries the set-up fee. */
export async function createSeatMapRequest(input: NewRequestInput): Promise<SeatMapRequestRow> {
  const fee = input.baseMapId ? 0 : await setupFeeCents();
  const ins = await execute(
    `INSERT INTO seat_map_requests (organization_id, venue_id, venue_name, venue_city, map_name, floor_plan_path, floor_plan_kind, notes, base_map_id, fee_cents, fee_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.organizationId, input.venueId, input.venueName, input.venueCity, input.mapName, input.floorPlan?.path ?? null, input.floorPlan?.kind ?? null, input.notes,
      input.baseMapId, fee, fee > 0 ? 'unpaid' : 'waived', input.userId],
  );
  await addNote(ins.insertId, input.userId, false, input.baseMapId ? 'Requested changes to an existing map.' : 'Requested a new seat map.', 'new');
  await audit('seatmap.request.created', { actorUserId: input.userId, targetType: 'seat_map_request', targetId: ins.insertId, metadata: { org: input.organizationId, fee, base: input.baseMapId } });
  const r = (await getSeatMapRequest(ins.insertId))!;
  await notifyStaff(r, input.baseMapId ? 'Change to a seat map requested' : 'New seat map request', input.notes ?? 'No notes.');
  return r;
}
