import 'server-only';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { getSettings, getStripeSettings } from '../settings';
import { organizerShareCents, payoutMode } from '../payments/connect';
import { getActiveStripe, stripeClient } from '../payments/stripe';
import { randomToken } from '../security/crypto';

/**
 * Referral rewards (11.9), built on the promoter / affiliate tracking links (plan 5.2): every referrer's personal link
 * is a tracking link, so clicks, attribution (`/r/<code>`, the `ref` checkout field) and "sales by link" reuse them.
 *
 * Money rules:
 *  - Rewards come out of the organizer's proceeds; the buyer pays the same price with or without a link.
 *  - Only completed, paid sales earn a reward; refunds shrink or reverse it, disputes reverse it.
 *  - Nothing is paid before the event is over: a reward becomes payable on the same schedule as organizer payouts
 *    (connect_payout_delay_days after the event ends), and is paid once the referrer has set up payout details.
 *  - No reward for buying through your own link. Unusual patterns (several orders from one network) are flagged and
 *    held until Fattixx support clears them.
 *  - Fattixx's share of each reward is the referral_platform_share_bps setting (0 by default).
 *
 * With Stripe Connect, the reward is taken back from the organizer's transfer for that order (a transfer reversal) and
 * sent to the referrer's Express account; the organizer's event payout is reduced by the same amount. With manual
 * payouts, the settlement statement shows the rewards as a line and Finance pays referrers from Admin → Referral payouts.
 */

export type OfferRow = Row & {
  id: number; event_id: number; organization_id: number; kind: 'public' | 'invite'; reward_type: 'fixed' | 'percent'; reward_basis: 'ticket' | 'order';
  reward_value: number; active: number; created_at: Date;
};

export function rewardLabel(o: Pick<OfferRow, 'reward_type' | 'reward_basis' | 'reward_value'>, currency = 'USD'): string {
  if (o.reward_type === 'percent') return `${(Number(o.reward_value) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}% of each sale`;
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(o.reward_value) / 100);
  return `${amount} per ${o.reward_basis === 'ticket' ? 'ticket' : 'order'}`;
}

/**
 * The reward an order earns now: fixed per live ticket, fixed per order (while any ticket is live), or a percentage of
 * the organizer's share, scaled down by what was refunded. Never more than the organizer's remaining share.
 */
export function computeReward(
  offer: Pick<OfferRow, 'reward_type' | 'reward_basis' | 'reward_value'>,
  order: { subtotal_cents: number; absorbed_fee_cents: number; total_cents: number; refunded_cents: number },
  liveTickets: number,
): number {
  const total = Number(order.total_cents);
  if (total <= 0 || liveTickets <= 0) return 0;
  const share = organizerShareCents(order);
  const keptFraction = Math.max(0, total - Number(order.refunded_cents)) / total;
  const remainingShare = Math.floor(share * keptFraction);
  let reward: number;
  if (offer.reward_type === 'percent') reward = Math.floor((remainingShare * Number(offer.reward_value)) / 10_000);
  else reward = offer.reward_basis === 'ticket' ? Number(offer.reward_value) * liveTickets : Number(offer.reward_value);
  return Math.max(0, Math.min(reward, remainingShare));
}

export async function platformShareBps(): Promise<number> {
  const v = Number((await getSettings()).referral_platform_share_bps);
  return Number.isFinite(v) ? Math.max(0, Math.min(10_000, Math.round(v))) : 0;
}

type OrderForReward = Row & {
  id: number; event_id: number; organization_id: number; user_id: number | null; buyer_email: string; status: string; currency: string; ip: string | null;
  subtotal_cents: number; absorbed_fee_cents: number; total_cents: number; refunded_cents: number; tracking_link_id: number | null; live: number; disputed: number;
};

async function orderForReward(orderId: number): Promise<OrderForReward | null> {
  return queryOne<OrderForReward>(
    `SELECT o.id, o.event_id, o.organization_id, o.user_id, o.buyer_email, o.status, o.currency, o.ip, o.subtotal_cents, o.absorbed_fee_cents, o.total_cents,
            o.refunded_cents, o.tracking_link_id,
            (SELECT COUNT(*) FROM tickets t WHERE t.order_id = o.id AND t.status IN ('valid','used','transferred') AND t.transferred_from_id IS NULL) AS live,
            EXISTS (SELECT 1 FROM disputes d WHERE d.order_id = o.id AND d.status <> 'won') AS disputed
       FROM orders o WHERE o.id = ?`, [orderId],
  );
}

/** Credit the referrer for a newly paid order (called once the order is paid; safe to call twice). */
export async function recordReferralReward(orderId: number): Promise<number | null> {
  const o = await orderForReward(orderId);
  if (!o || !o.tracking_link_id || o.status !== 'paid' || Number(o.total_cents) <= 0) return null;
  const ref = await queryOne<Row & { id: number; user_id: number | null; status: string; email: string | null } & OfferRow>(
    `SELECT r.id, r.user_id, r.status, u.email, f.reward_type, f.reward_basis, f.reward_value, f.active, f.event_id
       FROM referrers r JOIN referral_offers f ON f.id = r.offer_id LEFT JOIN users u ON u.id = r.user_id
      WHERE r.tracking_link_id = ?`, [o.tracking_link_id],
  );
  if (!ref || ref.status !== 'active' || !ref.user_id || !Number(ref.active) || Number(ref.event_id) !== Number(o.event_id)) return null;
  // No reward for buying through your own link.
  if (Number(o.user_id) === Number(ref.user_id) || (ref.email && ref.email.toLowerCase() === o.buyer_email.toLowerCase())) return null;
  const amount = computeReward(ref, o, Number(o.live));
  if (amount <= 0) return null;
  const bps = await platformShareBps();
  const platform = Math.floor((amount * bps) / 10_000);
  const r = await execute(
    `INSERT IGNORE INTO referral_rewards (referrer_id, order_id, event_id, organization_id, user_id, currency, original_cents, amount_cents, platform_cents, platform_bps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ref.id, o.id, o.event_id, o.organization_id, ref.user_id, o.currency, amount, amount, platform, bps],
  );
  if (r.affectedRows) await flagUnusualPatterns(Number(ref.id), o);
  return r.affectedRows ? r.insertId : null;
}

/** Several referred orders from one network (device / card proxy) for one referrer: hold them for a support review. */
async function flagUnusualPatterns(referrerId: number, o: OrderForReward): Promise<void> {
  if (!o.ip) return;
  const same = await queryOne<Row & { n: number; emails: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT LOWER(ord.buyer_email)) AS emails FROM referral_rewards rr JOIN orders ord ON ord.id = rr.order_id
      WHERE rr.referrer_id = ? AND ord.ip = ?`, [referrerId, o.ip],
  );
  if (Number(same?.n) >= 3) {
    await execute(
      `UPDATE referral_rewards rr JOIN orders ord ON ord.id = rr.order_id SET rr.flagged = 1, rr.flag_reason = ?
        WHERE rr.referrer_id = ? AND ord.ip = ? AND rr.status IN ('pending','payable')`,
      [`${same?.n} orders from the same network (${same?.emails} different emails)`, referrerId, o.ip],
    );
  }
}

/** Bring a reward in line with its order after a refund, cancellation or dispute. Paid rewards are left as they are. */
export async function recomputeReferralReward(orderId: number): Promise<void> {
  const rr = await queryOne<Row & { id: number; status: string; referrer_id: number; platform_bps: number }>(`SELECT id, status, referrer_id, platform_bps FROM referral_rewards WHERE order_id = ?`, [orderId]);
  if (!rr || rr.status === 'paid' || rr.status === 'reversed') return;
  const o = await orderForReward(orderId);
  const offer = await queryOne<OfferRow>(`SELECT f.* FROM referral_offers f JOIN referrers r ON r.offer_id = f.id WHERE r.id = ?`, [rr.referrer_id]);
  if (!o || !offer) return;
  const dead = Number(o.disputed) || !['paid', 'partially_refunded'].includes(o.status);
  const amount = dead ? 0 : computeReward(offer, o, Number(o.live));
  // the share in force when the reward was earned
  const platform = Math.floor((amount * Number(rr.platform_bps)) / 10_000);
  await execute(
    `UPDATE referral_rewards SET amount_cents = ?, platform_cents = ?, status = IF(? = 0, 'reversed', status) WHERE id = ? AND status IN ('pending','payable')`,
    [amount, platform, amount, rr.id],
  );
}

// ---------------------------------------------------------------------------
// Referrer links
// ---------------------------------------------------------------------------
function newCode(): string {
  return randomToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() || randomToken(6).toLowerCase();
}

/** Create the referrer's personal tracking link (once). */
export async function ensureReferrerLink(referrerId: number): Promise<string | null> {
  const r = await queryOne<Row & { tracking_link_id: number | null; organization_id: number; event_id: number; name: string | null; code: string | null }>(
    `SELECT r.tracking_link_id, f.organization_id, f.event_id, u.name, tl.code
       FROM referrers r JOIN referral_offers f ON f.id = r.offer_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN tracking_links tl ON tl.id = r.tracking_link_id
      WHERE r.id = ?`, [referrerId],
  );
  if (!r) return null;
  if (r.code) return r.code;
  for (let i = 0; i < 5; i++) {
    const code = `x${newCode()}`;
    try {
      const tl = await execute(
        `INSERT INTO tracking_links (organization_id, event_id, code, name, utm_source, utm_medium, created_by) VALUES (?, ?, ?, ?, 'referral', 'referral', NULL)`,
        [r.organization_id, r.event_id, code, `Referral: ${(r.name ?? 'referrer').slice(0, 100)}`],
      );
      await execute(`UPDATE referrers SET tracking_link_id = ? WHERE id = ?`, [tl.insertId, referrerId]);
      return code;
    } catch (e) {
      if (!String((e as Error).message).includes('Duplicate')) throw e;
    }
  }
  return null;
}

/** The viewer's referral code for an event, if they are an active referrer there. */
export async function myReferralCode(userId: number, eventId: number): Promise<string | null> {
  const r = await queryOne<Row & { code: string | null; id: number }>(
    `SELECT r.id, tl.code FROM referrers r JOIN referral_offers f ON f.id = r.offer_id LEFT JOIN tracking_links tl ON tl.id = r.tracking_link_id
      WHERE r.user_id = ? AND f.event_id = ? AND r.status = 'active' AND f.active = 1 ORDER BY f.kind = 'invite' DESC LIMIT 1`, [userId, eventId],
  );
  if (!r) return null;
  return r.code ?? (await ensureReferrerLink(Number(r.id)));
}

export async function getOffers(eventId: number): Promise<OfferRow[]> {
  return query<OfferRow>(`SELECT * FROM referral_offers WHERE event_id = ? ORDER BY kind`, [eventId]);
}

export async function publicOffer(eventId: number): Promise<OfferRow | null> {
  return queryOne<OfferRow>(`SELECT * FROM referral_offers WHERE event_id = ? AND kind = 'public' AND active = 1`, [eventId]);
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------
export type ReferrerDashRow = Row & {
  referrer_id: number; event_id: number; event_title: string; event_slug: string; starts_at: Date; ends_at: Date | null; kind: 'public' | 'invite';
  reward_type: 'fixed' | 'percent'; reward_basis: 'ticket' | 'order'; reward_value: number; currency: string; code: string | null; clicks: number;
  tickets: number; earned: number; pending: number; payable: number; paid: number; status: string;
};

/** The referrer's dashboard (11.9): link, clicks, tickets sold, earnings and payout status per event. */
export async function referrerDashboard(userId: number): Promise<ReferrerDashRow[]> {
  return query<ReferrerDashRow>(
    `SELECT r.id AS referrer_id, e.id AS event_id, e.title AS event_title, e.slug AS event_slug, e.starts_at, e.ends_at, e.currency, r.status,
            f.kind, f.reward_type, f.reward_basis, f.reward_value, tl.code, COALESCE(tl.clicks, 0) AS clicks,
            (SELECT COUNT(*) FROM tickets t JOIN orders o ON o.id = t.order_id JOIN referral_rewards x ON x.order_id = o.id
              WHERE x.referrer_id = r.id AND x.status <> 'reversed' AND t.status IN ('valid','used') ) AS tickets,
            COALESCE((SELECT SUM(x.amount_cents - x.platform_cents) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.status <> 'reversed'), 0) AS earned,
            COALESCE((SELECT SUM(x.amount_cents - x.platform_cents) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.status = 'pending'), 0) AS pending,
            COALESCE((SELECT SUM(x.amount_cents - x.platform_cents) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.status = 'payable'), 0) AS payable,
            COALESCE((SELECT SUM(x.amount_cents - x.platform_cents) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.status = 'paid'), 0) AS paid
       FROM referrers r JOIN referral_offers f ON f.id = r.offer_id JOIN events e ON e.id = f.event_id LEFT JOIN tracking_links tl ON tl.id = r.tracking_link_id
      WHERE r.user_id = ? AND r.status <> 'removed' ORDER BY e.starts_at DESC`, [userId],
  );
}

export type OrgReferrerRow = Row & {
  id: number; status: string; name: string | null; email: string | null; invite_email: string | null; invite_phone: string | null; kind: 'public' | 'invite';
  code: string | null; clicks: number; orders: number; tickets: number; revenue: number; rewards: number; flagged: number;
};

/** Sales by referrer for the organizer's reports. */
export async function eventReferrers(eventId: number): Promise<OrgReferrerRow[]> {
  return query<OrgReferrerRow>(
    `SELECT r.id, r.status, u.name, u.email, r.invite_email, r.invite_phone, f.kind, tl.code, COALESCE(tl.clicks, 0) AS clicks,
            (SELECT COUNT(*) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.status <> 'reversed') AS orders,
            (SELECT COUNT(*) FROM tickets t JOIN referral_rewards x ON x.order_id = t.order_id WHERE x.referrer_id = r.id AND x.status <> 'reversed' AND t.status IN ('valid','used')) AS tickets,
            COALESCE((SELECT SUM(o.total_cents - o.refunded_cents) FROM referral_rewards x JOIN orders o ON o.id = x.order_id WHERE x.referrer_id = r.id AND x.status <> 'reversed'), 0) AS revenue,
            COALESCE((SELECT SUM(x.amount_cents) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.status <> 'reversed'), 0) AS rewards,
            (SELECT COUNT(*) FROM referral_rewards x WHERE x.referrer_id = r.id AND x.flagged = 1 AND x.status IN ('pending','payable')) AS flagged
       FROM referrers r JOIN referral_offers f ON f.id = r.offer_id LEFT JOIN users u ON u.id = r.user_id LEFT JOIN tracking_links tl ON tl.id = r.tracking_link_id
      WHERE f.event_id = ? ORDER BY rewards DESC, r.id`, [eventId],
  );
}

/** Total rewards an event owes referrers (not reversed): the settlement statement line. */
export async function eventRewardsTotal(eventId: number): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM referral_rewards WHERE event_id = ? AND status <> 'reversed'`, [eventId]);
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Daily job: payable after the event, Stripe Connect claw-back and transfers.
// ---------------------------------------------------------------------------
export async function runReferralJobs(): Promise<{ swept: number; payable: number; clawed: number; paid: number }> {
  // 1. Re-check every open reward against its order (refunds, cancellations and disputes from any path).
  const open = await query<Row & { order_id: number }>(`SELECT order_id FROM referral_rewards WHERE status IN ('pending','payable') ORDER BY id LIMIT 5000`);
  for (const r of open) await recomputeReferralReward(Number(r.order_id));
  // Cancelled events earn nothing.
  await execute(`UPDATE referral_rewards rr JOIN events e ON e.id = rr.event_id SET rr.status = 'reversed', rr.amount_cents = 0, rr.platform_cents = 0
                  WHERE rr.status = 'pending' AND e.status = 'cancelled'`);
  // 2. After the event, on the organizer payout schedule: payable (unless flagged for review).
  const delay = Math.min(30, Math.max(0, Number((await getSettings()).connect_payout_delay_days) || 0));
  const payable = await execute(
    `UPDATE referral_rewards rr JOIN events e ON e.id = rr.event_id SET rr.status = 'payable', rr.payable_at = NOW()
      WHERE rr.status = 'pending' AND rr.flagged = 0 AND e.status <> 'cancelled' AND COALESCE(e.ends_at, e.starts_at) < NOW() - INTERVAL ? DAY`,
    [delay],
  );
  let clawed = 0, paid = 0;
  if ((await payoutMode()) === 'connect') {
    const active = await getActiveStripe();
    if (active) {
      const stripe = stripeClient(active.secretKey);
      await syncReferrerAccounts();
      // 3. Take each reward back from the organizer's transfer for that order.
      const toClaw = await query<Row & { id: number; amount_cents: number; stripe_charge_id: string | null; connect_account_id: string | null }>(
        `SELECT rr.id, rr.amount_cents, o.stripe_charge_id, o.connect_account_id FROM referral_rewards rr JOIN orders o ON o.id = rr.order_id
          WHERE rr.status IN ('payable','paid') AND rr.clawed_back = 0 AND rr.amount_cents > 0 AND o.connect_account_id IS NOT NULL AND o.stripe_charge_id IS NOT NULL LIMIT 500`,
      );
      for (const r of toClaw) {
        try {
          const charge = await stripe.charges.retrieve(r.stripe_charge_id!);
          const transferId = typeof charge.transfer === 'string' ? charge.transfer : charge.transfer?.id;
          if (!transferId) continue;
          await stripe.transfers.createReversal(transferId, { amount: Number(r.amount_cents), metadata: { referral_reward_id: String(r.id) } }, { idempotencyKey: `referral-clawback-${r.id}` });
          await execute(`UPDATE referral_rewards SET clawed_back = 1 WHERE id = ?`, [r.id]);
          await audit('referral.clawback', { targetType: 'referral_reward', targetId: r.id, metadata: { amount: Number(r.amount_cents), transfer: transferId } });
          clawed++;
        } catch (e) { console.error('[referrals] claw-back failed', r.id, (e as Error).message); }
      }
      // 4. Pay referrers whose Express account can receive transfers (earnings wait until setup is complete).
      const { mode } = await getStripeSettings();
      const due = await query<Row & { id: number; amount_cents: number; platform_cents: number; currency: string; account_id: string }>(
        `SELECT rr.id, rr.amount_cents, rr.platform_cents, rr.currency, a.account_id FROM referral_rewards rr
           JOIN orders o ON o.id = rr.order_id
           JOIN referrer_payout_accounts a ON a.user_id = rr.user_id AND a.stripe_mode = ? AND a.transfers_active = 1
          WHERE rr.status = 'payable' AND rr.flagged = 0 AND (rr.clawed_back = 1 OR o.connect_account_id IS NULL) LIMIT 500`,
        [mode],
      );
      for (const r of due) {
        const net = Number(r.amount_cents) - Number(r.platform_cents);
        try {
          let ref: string | null = null;
          if (net > 0) {
            const t = await stripe.transfers.create(
              { amount: net, currency: r.currency.toLowerCase(), destination: r.account_id, metadata: { referral_reward_id: String(r.id) } },
              { idempotencyKey: `referral-payout-${r.id}` },
            );
            ref = t.id;
          }
          await execute(`UPDATE referral_rewards SET status = 'paid', paid_at = NOW(), payout_reference = ? WHERE id = ? AND status = 'payable'`, [ref, r.id]);
          await audit('referral.reward.paid', { targetType: 'referral_reward', targetId: r.id, metadata: { amount: net, transfer: ref } });
          paid++;
        } catch (e) { console.error('[referrals] payout failed', r.id, (e as Error).message); }
      }
    }
  }
  return { swept: open.length, payable: payable.affectedRows, clawed, paid };
}

/** Rewards already taken back from an event's transfers: the Connect event payout is reduced by this. */
export async function clawedBackForEvent(eventId: number): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM referral_rewards WHERE event_id = ? AND clawed_back = 1`, [eventId]);
  return Number(r?.n ?? 0);
}

export async function syncReferrerAccounts(): Promise<void> {
  const active = await getActiveStripe();
  if (!active) return;
  const stripe = stripeClient(active.secretKey);
  const rows = await query<Row & { user_id: number; account_id: string }>(
    `SELECT user_id, account_id FROM referrer_payout_accounts WHERE account_id IS NOT NULL AND stripe_mode = ? AND transfers_active = 0 LIMIT 200`, [active.mode],
  );
  for (const r of rows) {
    try {
      const acct = await stripe.accounts.retrieve(r.account_id);
      await execute(`UPDATE referrer_payout_accounts SET transfers_active = ? WHERE user_id = ?`, [acct.capabilities?.transfers === 'active' ? 1 : 0, r.user_id]);
    } catch (e) { console.error('[referrals] account sync failed', r.account_id, (e as Error).message); }
  }
}

export type StaffRewardRow = Row & {
  id: number; order_id: number; order_code: string; event_title: string; org_name: string; referrer_name: string | null; referrer_email: string | null;
  buyer_email: string; ip: string | null; amount_cents: number; platform_cents: number; currency: string; status: string; flagged: number; flag_reason: string | null;
  clawed_back: number; payable_at: Date | null; paid_at: Date | null; payout_reference: string | null; created_at: Date;
};

/** Admin → Referral payouts: flagged rewards first, then the most recent. */
export async function listRewardsForStaff(filter: 'flagged' | 'recent'): Promise<StaffRewardRow[]> {
  return query<StaffRewardRow>(
    `SELECT rr.*, o.code AS order_code, o.buyer_email, o.ip, e.title AS event_title, g.name AS org_name, u.name AS referrer_name, u.email AS referrer_email
       FROM referral_rewards rr JOIN orders o ON o.id = rr.order_id JOIN events e ON e.id = rr.event_id JOIN organizations g ON g.id = rr.organization_id
       LEFT JOIN users u ON u.id = rr.user_id
      ${filter === 'flagged' ? "WHERE rr.flagged = 1 AND rr.status IN ('pending','payable')" : ''}
      ORDER BY rr.id DESC LIMIT 200`,
  );
}

export async function rewardTotals(): Promise<{ pending: number; payable: number; paid: number; platform: number }> {
  const r = await queryOne<Row & { pending: number; payable: number; paid: number; platform: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents END), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'payable' THEN amount_cents - platform_cents END), 0) AS payable,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents - platform_cents END), 0) AS paid,
            COALESCE(SUM(CASE WHEN status IN ('payable','paid') THEN platform_cents END), 0) AS platform
       FROM referral_rewards`,
  );
  return { pending: Number(r?.pending ?? 0), payable: Number(r?.payable ?? 0), paid: Number(r?.paid ?? 0), platform: Number(r?.platform ?? 0) };
}
