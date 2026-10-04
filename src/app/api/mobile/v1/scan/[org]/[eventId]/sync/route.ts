import { syncOfflineScans, type OfflineScan } from '@/lib/checkin/actions';
import { ApiError, handle, json, readJson, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ org: string; eventId: string }> };

/**
 * POST (Bearer) → apply check-ins the app recorded while offline (plan 8.2).
 *   { deviceId, items: [{ ref, ticketId, kind: 'valid' | 'manual', at }] }
 * Idempotent per `ref`: a retried upload after a dropped connection never double-counts. Tickets that were
 * meanwhile admitted elsewhere, refunded or transferred come back as `conflicts` for the organiser to review.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  const orgSlug = v.slug(org, 'organization');
  const id = v.int(eventId, 'event', { min: 1 });
  const body = await readJson(req, 256 * 1024);
  const deviceId = v.str(body.deviceId, 40, 'device', { required: true, min: 4 });
  if (!/^[\w-]+$/.test(deviceId)) throw new ApiError(400, 'Device is invalid.', 'device');
  const items = v.array<OfflineScan>(body.items, 'items', 500, (x, i) => {
    const o = v.obj(x, `items[${i}]`);
    const ref = v.str(o.ref, 64, 'ref', { required: true, min: 8 });
    if (!/^[\w-]{8,64}$/.test(ref)) throw new ApiError(400, 'A check-in reference is invalid.', 'items');
    const at = v.str(o.at, 40, 'at', { required: true });
    if (Number.isNaN(Date.parse(at))) throw new ApiError(400, 'A check-in time is invalid.', 'items');
    return { ref, ticketId: v.int(o.ticketId, 'ticket', { min: 1 }), kind: o.kind === 'manual' ? 'manual' : 'valid', at };
  });
  return json(await syncOfflineScans(orgSlug, id, deviceId, items));
});
