import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/request';
import { ipIsThrottled } from '@/lib/security/rate-limit';
import { rateLimited } from '@/lib/security/bot';
import { findUserByEmail, isEmail, sendSetPasswordLink } from '@/lib/users';
import { fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST { email } → always the same message, whether or not the account exists. */
export const POST = handle(async (req) => {
  const body = await readJson(req, 4 * 1024);
  const email = v.str(body.email, 254, 'email', { required: true });
  const ip = await clientIp();
  if (await ipIsThrottled(ip) || rateLimited(`forgot:${ip}`, 10, 15 * 60_000)) return fail(429, 'Too many attempts from this network. Try again later.');
  const done = { message: 'If an account exists for that email, a password link has been sent.' };
  if (!isEmail(email)) return json(done);
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') return json(done);
  await sendSetPasswordLink(user, { invitedBy: null, context: 'Fattixx', purpose: 'reset_password' });
  await audit('auth.password.reset_requested', { actorUserId: user.id, metadata: { client: 'mobile' } });
  return json(done);
});
