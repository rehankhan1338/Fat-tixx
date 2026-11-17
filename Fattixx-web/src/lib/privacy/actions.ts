'use server';

import { redirect } from 'next/navigation';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { clearSessionCookie, getSession, revokeAllUserSessions } from '../auth/session';
import { verifyPassword } from '../security/password';
import { deleteUpload } from '../uploads';

/**
 * Self-service data deletion (plan 11.5). The account is anonymized rather than removed: order,
 * refund and check-in records must be kept for accounting, tax and dispute evidence (see the Privacy
 * Policy's retention section), but they are detached from the account and marketing consent is withdrawn.
 * Data export is a download route: /api/account/export.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;

export async function deleteMyAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  if (String(fd.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') return { error: 'Type DELETE to confirm.' };
  const user = await queryOne<Row & { id: number; email: string; password_hash: string | null }>(`SELECT id, email, password_hash FROM users WHERE id = ?`, [session.user.id]);
  if (!user) return { error: 'Account not found.' };
  if (user.password_hash && !(await verifyPassword(user.password_hash, String(fd.get('password') ?? '')))) return { error: 'That password is not correct.' };
  if (session.user.roles.length) return { error: 'Platform staff accounts are removed by a Super Admin.' };
  const adminOf = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM organization_members WHERE user_id = ? AND role = 'org_admin'`, [user.id]);
  if (Number(adminOf?.n ?? 0) > 0) return { error: 'You are an Organization Admin. Hand the organization to another admin (Team page) before deleting your account.' };

  const email = user.email.toLowerCase();
  await revokeAllUserSessions(user.id, 'account_deleted');
  await execute(`DELETE FROM organization_members WHERE user_id = ?`, [user.id]);
  await execute(`DELETE FROM event_members WHERE user_id = ?`, [user.id]);
  await execute(`DELETE FROM waitlist_entries WHERE email = ?`, [email]);
  await execute(`DELETE FROM one_time_tokens WHERE user_id = ? OR email = ?`, [user.id, email]);
  await execute(`UPDATE orders SET user_id = NULL, marketing_opt_in = 0, sms_opt_in = 0 WHERE user_id = ? OR buyer_email = ?`, [user.id, email]);
  // Social & Community (11.11): the profile, follows (both ways), blocks, posts, reactions and guest-list choices go.
  // Referral rewards already earned stay for accounting; the links stop earning.
  const avatar = await queryOne<Row & { avatar_path: string | null }>(`SELECT avatar_path FROM users WHERE id = ?`, [user.id]);
  await execute(`DELETE FROM org_follows WHERE user_id = ?`, [user.id]);
  await execute(`DELETE FROM user_follows WHERE follower_id = ? OR followee_id = ?`, [user.id, user.id]);
  await execute(`DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?`, [user.id, user.id]);
  await execute(`DELETE FROM event_post_reactions WHERE user_id = ?`, [user.id]);
  await execute(`DELETE FROM event_posts WHERE user_id = ?`, [user.id]);
  await execute(`DELETE FROM event_guest_prefs WHERE user_id = ?`, [user.id]);
  await execute(`DELETE FROM event_feed_members WHERE user_id = ?`, [user.id]);
  await execute(`UPDATE referrers r LEFT JOIN tracking_links tl ON tl.id = r.tracking_link_id SET r.status = 'removed', tl.active = 0 WHERE r.user_id = ?`, [user.id]);
  await execute(`UPDATE referrer_payout_accounts SET manual_details = NULL WHERE user_id = ?`, [user.id]);
  if (avatar?.avatar_path) await deleteUpload(avatar.avatar_path);
  const anon = `deleted-${user.id}@deleted.invalid`;
  await execute(
    `UPDATE users SET email = ?, email_normalized = ?, name = 'Deleted user', phone = NULL, password_hash = NULL, marketing_opt_in = 0, status = 'disabled', email_verified_at = NULL,
            username = NULL, avatar_path = NULL, bio = NULL, city = NULL, instagram = NULL, tiktok = NULL, x_handle = NULL, favorite_categories = NULL,
            show_on_guest_lists = 0, show_events_on_profile = 0, social_sms_opt_in = 0 WHERE id = ?`,
    [anon, anon, user.id],
  );
  await audit('user.self_deleted', { actorUserId: user.id, targetType: 'user', targetId: user.id });
  await clearSessionCookie();
  redirect('/?account=deleted');
}
