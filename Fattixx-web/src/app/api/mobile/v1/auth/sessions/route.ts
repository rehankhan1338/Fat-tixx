import { audit } from '@/lib/audit';
import { listUserSessions } from '@/lib/auth/queries';
import { MOBILE_UA_PREFIX } from '@/lib/auth/session';
import { execute } from '@/lib/db';
import { handle, json, readJson, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET (Bearer) → the user's live sessions (browser and app), the current one flagged. */
export const GET = handle(async () => {
  const session = await requireUser();
  const rows = await listUserSessions(session.user.id);
  return json({
    sessions: rows.map((r) => ({
      id: r.id, current: r.id === session.id, createdAt: new Date(r.created_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(),
      kind: r.user_agent?.startsWith(MOBILE_UA_PREFIX) ? 'app' : 'browser',
      device: r.user_agent?.startsWith(MOBILE_UA_PREFIX) ? r.user_agent.slice(MOBILE_UA_PREFIX.length) : (r.user_agent ?? '').slice(0, 80),
      ip: r.ip,
    })),
  });
});

/** DELETE (Bearer) { sessionId } → sign out another device. The current session cannot be revoked here (use logout). */
export const DELETE = handle(async (req) => {
  const session = await requireUser();
  const body = await readJson(req, 2 * 1024);
  const target = v.str(body.sessionId, 64, 'session');
  if (!/^[0-9a-f]{64}$/.test(target) || target === session.id) return json({ ok: false });
  const r = await execute(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'revoked_by_user' WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [target, session.user.id],
  );
  if (r.affectedRows) await audit('auth.session.revoked', { actorUserId: session.user.id, targetType: 'session', targetId: target.slice(0, 12) });
  return json({ ok: r.affectedRows > 0 });
});
