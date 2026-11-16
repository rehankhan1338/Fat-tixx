import { queuePush } from '@/lib/push';
import { rateLimited } from '@/lib/security/bot';
import { fail, handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST (Bearer) → sends a test notification to the signed-in person's phones. { queued: number of devices } */
export const POST = handle(async () => {
  const session = await requireUser();
  if (rateLimited(`push-test:${session.user.id}`, 5, 10 * 60_000)) return fail(429, 'Too many test notifications. Please wait a few minutes.');
  const queued = await queuePush([session.user.id], { kind: 'test', title: 'Notifications are on', body: 'This phone will get alerts about your events.', url: '/account' });
  if (!queued) return fail(409, 'This phone is not registered for notifications yet. Allow notifications and try again.');
  return json({ queued });
});
