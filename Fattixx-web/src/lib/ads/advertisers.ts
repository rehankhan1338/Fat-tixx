import 'server-only';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { formatCents } from '../money';
import { noticeToStaff } from '../simple-email';

/**
 * Self-service advertiser portal (Phase 3, plan section 14):
 *   1. A brand signs in and applies at /advertise (company, contact, website). A Super Admin approves it
 *      (Admin → Advertisers); only approved advertisers can build campaigns.
 *   2. At /advertiser they build campaigns with the shared campaign editor: the attendee-facing placements
 *      (ADVERTISER_PLACEMENTS), targeting (state, city, category, ticket type, role, …), dates and creatives.
 *   3. They buy a number of impressions (price = impressions × ad_cpm_cents / 1000) through Stripe Checkout. The
 *      webhook marks the campaign paid and submits it for review.
 *   4. A Super Admin reviews it in Admin → Ads: activating it approves it; rejecting it refunds the payment.
 *   5. The campaign serves until its dates end or impressions_served reaches impressions_cap. Edits to a paid
 *      campaign send it back for review. Statistics are the same as for every campaign.
 * Fattixx Pro events never show advertiser ads (src/lib/ads/serve.ts), like every third-party ad.
 */
export type AdvertiserRow = Row & {
  id: number; user_id: number; company_name: string; contact_name: string; contact_email: string; website: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'suspended'; review_notes: string | null; reviewed_at: Date | null; created_at: Date;
};

export async function advertiserForUser(userId: number): Promise<AdvertiserRow | null> {
  return queryOne<AdvertiserRow>(`SELECT * FROM advertisers WHERE user_id = ?`, [userId]);
}

export async function approvedAdvertiser(userId: number): Promise<AdvertiserRow | null> {
  const a = await advertiserForUser(userId);
  return a && a.status === 'approved' ? a : null;
}

export async function listAdvertisers(): Promise<(AdvertiserRow & { campaigns: number; spent_cents: number })[]> {
  return query<AdvertiserRow & { campaigns: number; spent_cents: number }>(
    `SELECT a.*, (SELECT COUNT(*) FROM ad_campaigns c WHERE c.advertiser_id = a.id) AS campaigns,
            (SELECT COALESCE(SUM(c.price_cents),0) FROM ad_campaigns c WHERE c.advertiser_id = a.id AND c.payment_status = 'paid') AS spent_cents
       FROM advertisers a ORDER BY FIELD(a.status, 'pending', 'approved', 'suspended', 'rejected'), a.created_at DESC LIMIT 500`,
  );
}

export type AdvertiserCampaignRow = Row & {
  id: number; name: string; status: string; starts_at: Date | null; ends_at: Date | null; impressions_cap: number | null; impressions_served: number;
  price_cents: number | null; payment_status: string | null; review_status: string; review_notes: string | null; created_at: Date;
  impressions: number; clicks: number; creatives: number; placements: string | null;
};

export async function listAdvertiserCampaigns(advertiserId: number): Promise<AdvertiserCampaignRow[]> {
  return query<AdvertiserCampaignRow>(
    `SELECT c.id, c.name, c.status, c.starts_at, c.ends_at, c.impressions_cap, c.impressions_served, c.price_cents, c.payment_status, c.review_status, c.review_notes, c.created_at,
            (SELECT COALESCE(SUM(s.impressions),0) FROM ad_stats s WHERE s.campaign_id = c.id) AS impressions,
            (SELECT COALESCE(SUM(s.clicks),0) FROM ad_stats s WHERE s.campaign_id = c.id) AS clicks,
            (SELECT COUNT(*) FROM ad_creatives cr WHERE cr.campaign_id = c.id) AS creatives,
            (SELECT GROUP_CONCAT(p.placement ORDER BY p.placement) FROM ad_campaign_placements p WHERE p.campaign_id = c.id) AS placements
       FROM ad_campaigns c WHERE c.advertiser_id = ? ORDER BY c.created_at DESC`, [advertiserId],
  );
}

/** What the advertiser sees as the campaign's state. */
export function advertiserCampaignState(c: { status: string; payment_status: string | null; review_status: string; impressions_cap: number | null; impressions_served: number; ends_at: Date | null }): string {
  if (c.payment_status === 'refunded') return 'refunded';
  if (c.payment_status !== 'paid') return 'unpaid';
  if (c.review_status === 'rejected') return 'rejected';
  if (c.review_status === 'submitted') return 'in_review';
  if (c.impressions_cap && Number(c.impressions_served) >= Number(c.impressions_cap)) return 'completed';
  if (c.ends_at && new Date(c.ends_at) < new Date()) return 'expired';
  return c.status === 'active' ? 'active' : c.status;
}

/**
 * Webhook (checkout.session.completed, metadata.kind = ad_campaign): mark the campaign paid and submit it for review.
 * Only the session this campaign started counts, and only for the price it was started with.
 */
export async function markCampaignPaid(sessionId: string, paymentIntentId: string | null, amountTotal: number | null, campaignId: number): Promise<void> {
  const r = await execute(
    `UPDATE ad_campaigns SET payment_status = 'paid', stripe_payment_intent_id = ?, review_status = 'submitted', status = 'draft'
      WHERE id = ? AND stripe_checkout_session = ? AND price_cents = ? AND (payment_status IS NULL OR payment_status = 'unpaid')`,
    [paymentIntentId, campaignId, sessionId, amountTotal ?? -1],
  );
  if (!r.affectedRows) return;
  const c = await queryOne<Row & { name: string; price_cents: number; impressions_cap: number; company_name: string }>(
    `SELECT c.name, c.price_cents, c.impressions_cap, a.company_name FROM ad_campaigns c JOIN advertisers a ON a.id = c.advertiser_id WHERE c.id = ?`, [campaignId]);
  await audit('ad.paid', { targetType: 'ad_campaign', targetId: campaignId, metadata: { via: 'webhook', pi: paymentIntentId } });
  if (c) await noticeToStaff(`Ad campaign to review: ${c.name}`, [`${c.company_name} paid ${formatCents(Number(c.price_cents))} for ${Number(c.impressions_cap).toLocaleString()} impressions. Review the creatives and destination, then activate or reject it.`], { href: `${env.ADMIN_URL}/admin/ads/${campaignId}`, label: 'Review campaign' });
}
