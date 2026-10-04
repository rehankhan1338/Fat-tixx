import { audit } from '@/lib/audit';
import { APP_WEB_UA_PREFIX, revokeSession } from '@/lib/auth/session';
import { execute } from '@/lib/db';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST (Bearer) → revokes this device's session and every browser session its in-app web view opened. */
export const POST = handle(async () => {
  const session = await requireUser();
  await revokeSession(session.id, 'logout');
  await execute(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'app_logout' WHERE user_id = ? AND revoked_at IS NULL AND user_agent LIKE ?`,
    [session.user.id, `${APP_WEB_UA_PREFIX}%`],
  );
  await audit('auth.logout', { actorUserId: session.user.id, metadata: { client: 'mobile' } });
  return json({ ok: true });
});
