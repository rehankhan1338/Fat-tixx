import { audit } from '@/lib/audit';
import { registerAttendeeAccount } from '@/lib/auth/credentials';
import { createBearerSession } from '@/lib/auth/session';
import { mobileAccount } from '@/lib/mobile/auth';
import { deviceLabel, fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * POST { name, email, password, device?, startedAt? } → { token, expiresAt, account }; 409 when the email already has an account.
 * `startedAt` (ms since epoch when the form opened) plays the role of the website's fill-time bot check.
 */
export const POST = handle(async (req) => {
  const body = await readJson(req, 8 * 1024);
  const startedAt = typeof body.startedAt === 'number' ? body.startedAt : 0;
  if (startedAt && Date.now() - startedAt < 800) return fail(400, 'Something went wrong with that submission. Please wait a moment and try again.');
  const result = await registerAttendeeAccount({
    name: v.str(body.name, 120, 'name', { required: true, min: 2 }),
    email: v.str(body.email, 254, 'email', { required: true }),
    password: v.raw(body.password, 128, 'password'),
  });
  if (result.kind === 'error') return fail(result.status, result.error, result.field);
  const { token, expiresAt } = await createBearerSession(result.userId, deviceLabel(body));
  await audit('auth.session.created', { actorUserId: result.userId, metadata: { client: 'mobile' } });
  const account = await mobileAccount(result.userId);
  return json({ token, expiresAt: expiresAt.toISOString(), account, message: `We sent a confirmation link to ${result.email}.` });
});
