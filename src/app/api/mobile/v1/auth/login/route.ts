import { audit } from '@/lib/audit';
import { authenticateWithPassword } from '@/lib/auth/credentials';
import { createBearerSession } from '@/lib/auth/session';
import { mobileAccount } from '@/lib/mobile/auth';
import { appAccessError, deviceLabel, fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST { email, password, device? } → { token, expiresAt, account } */
export const POST = handle(async (req) => {
  const body = await readJson(req, 8 * 1024);
  const email = v.str(body.email, 254, 'email', { required: true });
  const password = v.raw(body.password, 128, 'password');
  const result = await authenticateWithPassword(email, password);
  if (!result.ok) return fail(result.status, result.error);
  // Credentials are right, but some roles must use the website for now: no session is created.
  const account = await mobileAccount(result.user.id);
  const blocked = appAccessError(account?.user.roles ?? []);
  if (!account || blocked) {
    await audit('auth.login.failed', { actorUserId: result.user.id, metadata: { reason: 'role_blocked_in_app', client: 'mobile' } });
    return fail(403, blocked ?? 'This account cannot use the app.');
  }
  const { token, expiresAt } = await createBearerSession(result.user.id, deviceLabel(body));
  await audit('auth.session.created', { actorUserId: result.user.id, metadata: { client: 'mobile' } });
  return json({ token, expiresAt: expiresAt.toISOString(), account });
});
