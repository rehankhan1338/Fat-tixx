import { isExpoPushToken, registerDevice, unregisterDevice } from '@/lib/push';
import { rateLimited } from '@/lib/security/bot';
import { ApiError, fail, handle, json, readJson, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * Push notification registration for this app session (see src/lib/push.ts).
 *
 * POST   (Bearer) { token: "ExponentPushToken[...]", platform: "ios" | "android" } → { ok: true }
 *        Called after sign-in and on every launch, so a changed token replaces the old one.
 * DELETE (Bearer) { token? } → { ok: true }. Notifications switched off in the app. Sign-out needs no call:
 *        a revoked session stops receiving pushes and its devices are removed by /auth/logout.
 */
export const POST = handle(async (req) => {
  const session = await requireUser();
  if (rateLimited(`push-register:${session.id}`, 30, 60 * 60_000)) return fail(429, 'Too many attempts. Please try again later.');
  const body = await readJson(req, 2048);
  if (!isExpoPushToken(body.token)) throw new ApiError(400, 'Invalid push token.', 'token');
  if (body.platform !== 'ios' && body.platform !== 'android') throw new ApiError(400, 'Invalid platform.', 'platform');
  await registerDevice({ userId: session.user.id, sessionId: session.id, token: body.token, platform: body.platform });
  return json({ ok: true });
});

export const DELETE = handle(async (req) => {
  const session = await requireUser();
  const body = await readJson(req, 2048);
  await unregisterDevice(session.id, isExpoPushToken(body.token) ? body.token : null);
  return json({ ok: true });
});
