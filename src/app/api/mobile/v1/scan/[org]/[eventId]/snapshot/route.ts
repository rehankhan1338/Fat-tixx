import { scannerSnapshot } from '@/lib/checkin/actions';
import { handle, json, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ org: string; eventId: string }> };

/**
 * GET (Bearer) → the offline ticket list for one event (plan 8.2).
 *
 * The app stores this on the device so the door keeps moving when the venue has no signal. Each ticket
 * carries only a hash of its signed QR payload, never the secret or the signature, so a stolen phone
 * cannot be used to forge tickets. Expires 24 h after the event ends; the app deletes it then.
 */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  const snapshot = await scannerSnapshot(v.slug(org, 'organization'), v.int(eventId, 'event', { min: 1 }));
  return json(snapshot);
});
