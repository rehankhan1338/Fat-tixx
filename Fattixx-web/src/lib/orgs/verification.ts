import 'server-only';
import { audit } from '../audit';
import { execute, query, queryOne, type Row } from '../db';

/**
 * Paid events need a verified organization. An organization made on /create starts unverified: its free events go live
 * at once, but a paid event is held 'in_review' (hidden from the public; the team sees a preview) until platform staff
 * approve the organization's verification (/org/<slug>/verify, reviewed in Admin → Organizer applications), which
 * publishes every held event. Every way of putting a paid event on sale goes through liveStatus() or holdIfUnverified().
 */

export async function eventIsPaid(eventId: number): Promise<boolean> {
  return !!(await queryOne(`SELECT 1 FROM ticket_types WHERE event_id = ? AND price_cents > 0 LIMIT 1`, [eventId]));
}

/** The status an event takes when it is published: 'in_review' for a paid event of an unverified organization. */
export async function liveStatus(eventId: number, orgVerified: boolean): Promise<'published' | 'in_review'> {
  return !orgVerified && (await eventIsPaid(eventId)) ? 'in_review' : 'published';
}

/** After ticket changes: a live event of an unverified organization that now has a paid ticket goes back into review. */
export async function holdIfUnverified(eventId: number, orgVerified: boolean, actorUserId: number): Promise<boolean> {
  if (orgVerified || !(await eventIsPaid(eventId))) return false;
  const r = await execute(`UPDATE events SET status = 'in_review' WHERE id = ? AND status = 'published'`, [eventId]);
  if (!r.affectedRows) return false;
  await audit('event.held_for_review', { actorUserId, targetType: 'event', targetId: eventId, metadata: { reason: 'paid_tickets_unverified_org' } });
  return true;
}

export type VerificationState = { verified: boolean; pending: boolean; rejectedNotes: string | null; heldEvents: number };

export async function verificationState(org: { id: number; verified_at: Date | null }): Promise<VerificationState> {
  if (org.verified_at) return { verified: true, pending: false, rejectedNotes: null, heldEvents: 0 };
  const [app, held] = await Promise.all([
    queryOne<Row & { status: string; review_notes: string | null }>(
      `SELECT status, review_notes FROM organizer_applications WHERE organization_id = ? ORDER BY id DESC LIMIT 1`, [org.id],
    ),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE organization_id = ? AND status = 'in_review'`, [org.id]),
  ]);
  return { verified: false, pending: app?.status === 'pending', rejectedNotes: app?.status === 'rejected' ? app.review_notes : null, heldEvents: Number(held?.n ?? 0) };
}

/** On approval: publish the organization's held events. Returns their titles for the email. */
export async function releaseHeldEvents(orgId: number, actorUserId: number): Promise<{ id: number; slug: string; title: string }[]> {
  const held = await query<Row & { id: number; slug: string; title: string }>(`SELECT id, slug, title FROM events WHERE organization_id = ? AND status = 'in_review'`, [orgId]);
  for (const e of held) {
    const r = await execute(`UPDATE events SET status = 'published' WHERE id = ? AND status = 'in_review'`, [e.id]);
    if (r.affectedRows) await audit('event.published', { actorUserId, targetType: 'event', targetId: e.id, metadata: { status: 'published', viaVerification: true } });
  }
  return held.map((e) => ({ id: Number(e.id), slug: e.slug, title: e.title }));
}
