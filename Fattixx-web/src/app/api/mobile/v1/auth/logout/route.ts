import { audit } from '@/lib/audit';
import { revokeSession } from '@/lib/auth/session';
import { handle, json, requireUser } from '@/lib/mobile/http';
import { unregisterDevice } from '@/lib/push';

export const dynamic = 'force-dynamic';

/** POST (Bearer) → revokes this device's session. */
export const POST = handle(async () => {
  const session = await requireUser();
  await revokeSession(session.id, 'logout');
  await unregisterDevice(session.id); // no more pushes to this phone
  await audit('auth.logout', { actorUserId: session.user.id, metadata: { client: 'mobile' } });
  return json({ ok: true });
});
