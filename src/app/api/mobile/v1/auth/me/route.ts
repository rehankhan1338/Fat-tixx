import { mobileAccount } from '@/lib/mobile/auth';
import { fail, handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET (Bearer) → { account } for the signed-in user. */
export const GET = handle(async () => {
  const session = await requireUser();
  const account = await mobileAccount(session.user.id);
  if (!account) return fail(401, 'Please sign in.');
  return json({ account, session: { createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString() } });
});
