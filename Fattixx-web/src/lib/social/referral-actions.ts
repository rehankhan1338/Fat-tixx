'use server';

import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { assertOrg, canAccessEvent } from '../authz';
import { getSession } from '../auth/session';
import { assertPlatformRole } from '../auth/guard';
import { getEvent } from '../events/queries';
import { isEmail, normalizeEmail } from '../users';
import { normalizePhone, sendSms } from '../sms';
import { sendNotice } from '../simple-email';
import { rateLimited } from '../security/bot';
import { encryptSecret, randomToken, sha256 } from '../security/crypto';
import { setSetting } from '../settings';
import { payoutMode } from '../payments/connect';
import { getStripe } from '../payments/stripe';
import { holdsTicket } from './core';
import { ensureReferrerLink, recomputeReferralReward, rewardLabel } from './referrals';

export type RefState = { ok?: boolean; error?: string; message?: string; url?: string; code?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const checked = (fd: FormData, k: string) => ['on', '1', 'true'].includes(String(fd.get(k) ?? ''));

async function orgEvent(fd: FormData) {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found.');
  return { ctx, event };
}

/** Organizer: create or change the public or invite-only offer for a paid event. */
export async function saveReferralOffer(_prev: RefState, fd: FormData): Promise<RefState> {
  let ctx, event;
  try { ({ ctx, event } = await orgEvent(fd)); } catch (e) { return { error: (e as Error).message }; }
  const kind = str(fd, 'kind', 10) === 'invite' ? 'invite' : 'public';
  const type = str(fd, 'reward_type', 10) === 'percent' ? 'percent' : 'fixed';
  const basis = str(fd, 'reward_basis', 10) === 'order' ? 'order' : 'ticket';
  const raw = Number(str(fd, 'reward_value', 20).replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(raw) || raw <= 0) return { error: 'Enter the reward.' };
  const value = Math.round(raw * 100); // cents, or basis points for a percentage
  if (type === 'percent' && value > 5000) return { error: 'A percentage reward can be at most 50%.' };
  if (type === 'fixed' && value > 100_000) return { error: 'That reward is too high.' };
  const paid = await queryOne(`SELECT 1 FROM ticket_types WHERE event_id = ? AND price_cents > 0`, [event.id]);
  if (!paid) return { error: 'Referral rewards are for paid events. Add a paid ticket type first.' };
  const active = checked(fd, 'active') ? 1 : 0;
  await execute(
    `INSERT INTO referral_offers (event_id, organization_id, kind, reward_type, reward_basis, reward_value, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reward_type = VALUES(reward_type), reward_basis = VALUES(reward_basis), reward_value = VALUES(reward_value), active = VALUES(active)`,
    [event.id, ctx.org.id, kind, type, basis, value, active, ctx.session.user.id],
  );
  await audit('referral.offer.saved', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { kind, type, basis, value, active } });
  revalidatePath(`/org/${ctx.org.slug}/events/${event.id}`);
  revalidatePath(`/events/${event.slug}`);
  return { ok: true, message: active ? 'Referral rewards are on.' : 'Saved (turned off).' };
}

/** Organizer: invite promoters, influencers or partners to the invite-only offer, by email or phone (one per line). */
export async function inviteReferrers(_prev: RefState, fd: FormData): Promise<RefState> {
  let ctx, event;
  try { ({ ctx, event } = await orgEvent(fd)); } catch (e) { return { error: (e as Error).message }; }
  const offer = await queryOne<Row & { id: number; reward_type: 'fixed' | 'percent'; reward_basis: 'ticket' | 'order'; reward_value: number; active: number }>(
    `SELECT id, reward_type, reward_basis, reward_value, active FROM referral_offers WHERE event_id = ? AND kind = 'invite'`, [event.id],
  );
  if (!offer) return { error: 'Set up the invite-only offer first.' };
  const lines = str(fd, 'contacts', 5000).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!lines.length) return { error: 'Add at least one email or phone number.' };
  if (rateLimited(`ref-invite:${ctx.org.id}`, 300, 60 * 60_000)) return { error: 'Too many invitations in an hour. Try again later.' };
  let sent = 0;
  const bad: string[] = [];
  for (const line of lines) {
    const email = isEmail(line) ? normalizeEmail(line) : null;
    const phone = email ? null : normalizePhone(line);
    if (!email && !phone) { bad.push(line); continue; }
    const existing = await queryOne(`SELECT 1 FROM referrers r LEFT JOIN users u ON u.id = r.user_id WHERE r.offer_id = ? AND r.status <> 'removed' AND (r.invite_email = ? OR r.invite_phone = ? OR u.email = ?)`,
      [offer.id, email, phone, email]);
    if (existing) continue;
    const token = randomToken(24);
    await execute(`INSERT INTO referrers (offer_id, user_id, invite_email, invite_phone, invite_token_hash, status) VALUES (?, NULL, ?, ?, ?, 'invited')`, [offer.id, email, phone, sha256(token)]);
    const url = `${env.APP_URL}/referrals/accept/${token}`;
    const reward = rewardLabel(offer, event.currency);
    if (email) {
      await sendNotice({ email }, `${ctx.org.name} invited you to promote ${event.title}`,
        [`${ctx.org.name} invited you to earn ${reward} for tickets sold through your personal link to ${event.title}.`,
          'Rewards are paid after the event ends. You must say you earn a reward whenever you promote the event.'],
        { href: url, label: 'Get my link' }, { type: 'event', id: event.id });
    } else {
      await sendSms(phone!, `${ctx.org.name} invited you to earn ${reward} promoting ${event.title} on Fattixx: ${url}`, { type: 'event', id: event.id });
    }
    sent++;
  }
  await audit('referral.referrer.invited', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { sent } });
  revalidatePath(`/org/${ctx.org.slug}/events/${event.id}`);
  // The form shows the error box when there is one, so it also says what was sent (otherwise organizers resend).
  return bad.length ? { ok: sent > 0, message: `${sent} invitation(s) sent.`, error: `${sent} invitation(s) sent. Not an email or phone number: ${bad.slice(0, 5).join(', ')}` } : { ok: true, message: `${sent} invitation(s) sent.` };
}

export async function removeReferrer(orgSlug: string, referrerId: number): Promise<RefState> {
  const ctx = await assertOrg(orgSlug, 'organizer');
  const r = await queryOne<Row & { organization_id: number; event_id: number; tracking_link_id: number | null }>(
    `SELECT f.organization_id, f.event_id, r.tracking_link_id FROM referrers r JOIN referral_offers f ON f.id = r.offer_id WHERE r.id = ?`, [referrerId],
  );
  if (!r || Number(r.organization_id) !== ctx.org.id) return { error: 'Not found.' };
  // Sales already made keep their rewards; the link stops earning.
  await execute(`UPDATE referrers SET status = 'removed' WHERE id = ?`, [referrerId]);
  if (r.tracking_link_id) await execute(`UPDATE tracking_links SET active = 0 WHERE id = ?`, [r.tracking_link_id]);
  await audit('referral.referrer.removed', { actorUserId: ctx.session.user.id, targetType: 'referrer', targetId: referrerId });
  revalidatePath(`/org/${orgSlug}/events/${r.event_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Referrers
// ---------------------------------------------------------------------------

/** Any ticket buyer can join a public offer and get a personal link (after accepting the Referral Rewards Terms). */
export async function joinPublicOffer(eventId: number, acceptTerms: boolean): Promise<RefState> {
  const session = await getSession();
  if (!session) return { error: 'signin' };
  if (!acceptTerms) return { error: 'Accept the Referral Rewards Terms to continue.' };
  const offer = await queryOne<Row & { id: number }>(`SELECT id FROM referral_offers WHERE event_id = ? AND kind = 'public' AND active = 1`, [eventId]);
  if (!offer) return { error: 'This event has no referral rewards right now.' };
  if (!(await holdsTicket(session.user.id, eventId))) return { error: 'Buy a ticket first: referral links are for ticket holders.' };
  await execute(
    `INSERT INTO referrers (offer_id, user_id, status, terms_accepted_at) VALUES (?, ?, 'active', NOW()) ON DUPLICATE KEY UPDATE terms_accepted_at = COALESCE(terms_accepted_at, NOW())`,
    [offer.id, session.user.id],
  );
  const r = await queryOne<Row & { id: number; status: string }>(`SELECT id, status FROM referrers WHERE offer_id = ? AND user_id = ?`, [offer.id, session.user.id]);
  if (!r || r.status === 'removed') return { error: 'The organizer removed you from this offer.' };
  const code = await ensureReferrerLink(Number(r.id));
  await audit('referral.joined', { actorUserId: session.user.id, targetType: 'event', targetId: eventId, metadata: { kind: 'public' } });
  return { ok: true, code: code ?? undefined, url: code ? `${env.APP_URL}/r/${code}` : undefined };
}

/** Accept an invitation (the person signs in or creates an account first). */
export async function acceptReferralInvite(token: string, acceptTerms: boolean): Promise<RefState> {
  const session = await getSession();
  if (!session) return { error: 'signin' };
  if (!acceptTerms) return { error: 'Accept the Referral Rewards Terms to continue.' };
  const r = await queryOne<Row & { id: number; offer_id: number; status: string; user_id: number | null; event_id: number }>(
    `SELECT r.id, r.offer_id, r.status, r.user_id, f.event_id FROM referrers r JOIN referral_offers f ON f.id = r.offer_id WHERE r.invite_token_hash = ?`, [sha256(token)],
  );
  if (!r || r.status === 'removed') return { error: 'This invitation is no longer valid.' };
  if (r.user_id && Number(r.user_id) !== session.user.id) return { error: 'This invitation was already accepted by another account.' };
  const already = await queryOne<Row & { id: number }>(`SELECT id FROM referrers WHERE offer_id = ? AND user_id = ? AND id <> ?`, [r.offer_id, session.user.id, r.id]);
  if (already) return { error: 'You already have a link for this offer.' };
  await execute(`UPDATE referrers SET user_id = ?, status = 'active', terms_accepted_at = NOW() WHERE id = ?`, [session.user.id, r.id]);
  const code = await ensureReferrerLink(Number(r.id));
  await audit('referral.joined', { actorUserId: session.user.id, targetType: 'event', targetId: r.event_id, metadata: { kind: 'invite' } });
  return { ok: true, code: code ?? undefined, url: code ? `${env.APP_URL}/r/${code}` : undefined };
}

/**
 * Payout details (11.9): with Stripe Connect, the referrer's own Express account (Stripe's onboarding); otherwise
 * details Finance pays to by hand, stored encrypted.
 */
export async function startReferrerOnboarding(): Promise<RefState> {
  const session = await getSession();
  if (!session) return { error: 'signin' };
  if ((await payoutMode()) !== 'connect') return { error: 'Add your payout details below instead.' };
  try {
    const { stripe, active } = await getStripe();
    let row = await queryOne<Row & { account_id: string | null; stripe_mode: string | null }>(`SELECT account_id, stripe_mode FROM referrer_payout_accounts WHERE user_id = ?`, [session.user.id]);
    if (!row?.account_id || row.stripe_mode !== active.mode) {
      const acct = await stripe.accounts.create({
        type: 'express', country: 'US', email: session.user.email, business_type: 'individual',
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: 'Referral rewards for promoting events on Fattixx', mcc: '7311' },
        metadata: { user_id: String(session.user.id), purpose: 'referrer' },
      }, { idempotencyKey: `referrer-account-${session.user.id}-${active.mode}` });
      await execute(
        `INSERT INTO referrer_payout_accounts (user_id, stripe_mode, account_id, transfers_active) VALUES (?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE stripe_mode = VALUES(stripe_mode), account_id = VALUES(account_id), transfers_active = 0`,
        [session.user.id, active.mode, acct.id],
      );
      row = { account_id: acct.id, stripe_mode: active.mode } as typeof row;
    }
    const link = await stripe.accountLinks.create({
      account: row!.account_id!, type: 'account_onboarding',
      return_url: `${env.APP_URL}/account/referrals?stripe=return`, refresh_url: `${env.APP_URL}/account/referrals?stripe=refresh`,
    });
    await audit('referral.payout_details', { actorUserId: session.user.id, targetType: 'user', targetId: session.user.id, metadata: { stripe: true } });
    return { ok: true, url: link.url };
  } catch (e) {
    return { error: `Stripe couldn’t start the setup: ${(e as Error).message}` };
  }
}

export async function saveManualPayoutDetails(_prev: RefState, fd: FormData): Promise<RefState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  const method = str(fd, 'method', 20);
  const handle = str(fd, 'handle', 200);
  if (!['paypal', 'venmo', 'zelle', 'cashapp'].includes(method)) return { error: 'Choose how you want to be paid.' };
  if (handle.length < 3) return { error: 'Add the account to pay.' };
  const blob = encryptSecret(JSON.stringify({ method, handle }), `referrer-payout:${session.user.id}`);
  await execute(
    `INSERT INTO referrer_payout_accounts (user_id, manual_details) VALUES (?, ?) ON DUPLICATE KEY UPDATE manual_details = VALUES(manual_details)`,
    [session.user.id, blob],
  );
  await audit('referral.payout_details', { actorUserId: session.user.id, targetType: 'user', targetId: session.user.id, metadata: { method } });
  revalidatePath('/account/referrals');
  return { ok: true, message: 'Payout details saved.' };
}

// ---------------------------------------------------------------------------
// Fattixx staff (Admin → Referral payouts)
// ---------------------------------------------------------------------------
export async function clearRewardFlag(rewardId: number): Promise<RefState> {
  const session = await assertPlatformRole(['super_admin', 'support', 'finance']);
  await execute(`UPDATE referral_rewards SET flagged = 0, flag_reason = CONCAT('Cleared: ', COALESCE(flag_reason, '')) WHERE id = ?`, [rewardId]);
  await audit('referral.reward.flag_cleared', { actorUserId: session.user.id, targetType: 'referral_reward', targetId: rewardId });
  revalidatePath('/admin/referrals');
  return { ok: true };
}

export async function reverseFlaggedReward(rewardId: number): Promise<RefState> {
  const session = await assertPlatformRole(['super_admin', 'support', 'finance']);
  await execute(`UPDATE referral_rewards SET status = 'reversed', amount_cents = 0, platform_cents = 0 WHERE id = ? AND status IN ('pending','payable') AND clawed_back = 0`, [rewardId]);
  await audit('referral.reward.flag_cleared', { actorUserId: session.user.id, targetType: 'referral_reward', targetId: rewardId, metadata: { reversed: true } });
  revalidatePath('/admin/referrals');
  return { ok: true };
}

/** Manual payouts: Finance paid a referrer everything payable (outside Stripe) and records the reference. */
export async function markReferrerPaid(userId: number, reference: string): Promise<RefState> {
  const session = await assertPlatformRole(['super_admin', 'finance']);
  const ref = reference.trim().slice(0, 120);
  if (ref.length < 2) return { error: 'Add the payment reference.' };
  const r = await execute(
    `UPDATE referral_rewards SET status = 'paid', paid_at = NOW(), payout_reference = ? WHERE user_id = ? AND status = 'payable' AND flagged = 0`, [ref, userId],
  );
  await audit('referral.reward.paid', { actorUserId: session.user.id, targetType: 'user', targetId: userId, metadata: { manual: true, rewards: r.affectedRows, reference: ref } });
  revalidatePath('/admin/referrals');
  return { ok: true, message: `${r.affectedRows} reward(s) marked paid.` };
}

export async function saveReferralShare(_prev: RefState, fd: FormData): Promise<RefState> {
  const session = await assertPlatformRole(['super_admin']);
  const pct = Number(str(fd, 'share_percent', 10));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: 'Enter a percentage from 0 to 100.' };
  await setSetting('referral_platform_share_bps', String(Math.round(pct * 100)), session.user.id);
  await audit('settings.updated', { actorUserId: session.user.id, metadata: { referral_platform_share_bps: Math.round(pct * 100) } });
  revalidatePath('/admin/referrals');
  return { ok: true, message: 'Saved. It applies to new rewards.' };
}

/** Staff re-check of one order's reward (e.g. after a dispute was settled by hand). */
export async function recheckReward(orderId: number): Promise<RefState> {
  await assertPlatformRole(['super_admin', 'finance']);
  await recomputeReferralReward(orderId);
  revalidatePath('/admin/referrals');
  return { ok: true };
}

/** Referrers who are owed money and how to pay them (decrypted for Finance only). */
export async function listOwedReferrers(): Promise<{ userId: number; name: string; email: string; owed: number; currency: string; method: string | null; stripe: boolean }[]> {
  await assertPlatformRole(['super_admin', 'finance']);
  const { decryptSecret } = await import('../security/crypto');
  const rows = await query<Row & { user_id: number; name: string; email: string; owed: number; currency: string; manual_details: string | null; transfers_active: number | null }>(
    `SELECT rr.user_id, u.name, u.email, SUM(rr.amount_cents - rr.platform_cents) AS owed, MAX(rr.currency) AS currency, a.manual_details, a.transfers_active
       FROM referral_rewards rr JOIN users u ON u.id = rr.user_id LEFT JOIN referrer_payout_accounts a ON a.user_id = rr.user_id
      WHERE rr.status = 'payable' AND rr.flagged = 0 GROUP BY rr.user_id, u.name, u.email, a.manual_details, a.transfers_active ORDER BY owed DESC`,
  );
  return rows.map((r) => {
    let method: string | null = null;
    if (r.manual_details) {
      try { const d = JSON.parse(decryptSecret(r.manual_details, `referrer-payout:${r.user_id}`)) as { method: string; handle: string }; method = `${d.method}: ${d.handle}`; } catch { method = 'unreadable'; }
    }
    return { userId: Number(r.user_id), name: r.name, email: r.email, owed: Number(r.owed), currency: r.currency, method, stripe: !!Number(r.transfers_active) };
  });
}
