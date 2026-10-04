import { liveCounts, manualCheckin, overrideCheckin, scanTicket, undoCheckin } from '@/lib/checkin/actions';
import { ApiError, handle, json, readJson, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ org: string; eventId: string }> };

/** GET (Bearer) → live check-in counts for the event. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  const counts = await liveCounts(v.slug(org, 'organization'), v.int(eventId, 'event', { min: 1 }));
  return json({ counts });
});

/**
 * POST (Bearer) → check someone in.
 *   { payload }                                  scanned QR text or a typed 12-character code
 *   { action: 'manual', ticketId }               admit from the door list
 *   { action: 'override', ticketId, reason }     admit despite the ticket's state (permission required, logged)
 *   { action: 'undo', ticketId, reason }         reverse a check-in (permission required, logged)
 * Authorization (org membership, event assignment, per-member override / undo rights) is enforced in lib/checkin.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  const orgSlug = v.slug(org, 'organization');
  const id = v.int(eventId, 'event', { min: 1 });
  const body = await readJson(req, 8 * 1024);
  const action = v.str(body.action, 20);
  if (!action || action === 'scan') {
    const payload = v.str(body.payload, 200, 'payload', { required: true });
    return json(await scanTicket(orgSlug, id, payload));
  }
  const ticketId = v.int(body.ticketId, 'ticket', { min: 1 });
  if (action === 'manual') return json(await manualCheckin(orgSlug, id, ticketId));
  const reason = v.str(body.reason, 200, 'reason', { required: true, min: 2 });
  if (action === 'override') return json(await overrideCheckin(orgSlug, id, ticketId, reason));
  if (action === 'undo') return json(await undoCheckin(orgSlug, id, ticketId, reason));
  throw new ApiError(400, 'Unknown action.');
});
