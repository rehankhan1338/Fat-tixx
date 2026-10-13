import { sendVerificationEmail } from '@/lib/auth/credentials';
import { rateLimited } from '@/lib/security/bot';
import { fail, handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST (Bearer) → resend the email confirmation link. */
export const POST = handle(async () => {
  const session = await requireUser();
  if (session.user.emailVerified) return json({ message: 'Your email is already confirmed.' });
  if (rateLimited(`verify:${session.user.id}`, 3, 15 * 60_000)) return fail(429, 'We just sent one. Check your inbox (and spam folder), or try again in a few minutes.');
  await sendVerificationEmail(session.user);
  return json({ message: `We sent a confirmation link to ${session.user.email}.` });
});
