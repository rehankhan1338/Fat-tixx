import 'server-only';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { formatCents } from '../money';
import { noticeToStaff, sendNotice } from '../simple-email';

/**
 * Sponsorship marketplace (Phase 3, plan section 14):
 *   1. Organizers list sponsorship packages (Dashboard → Sponsorships): a title, perks, a price and how many they sell,
 *      for one event or their whole season, optionally including a sponsor ad on the event page.
 *   2. Brands browse /sponsorships, sign in and request a package with a message.
 *   3. The Organization Admin accepts or declines. Accepting fixes Fattixx's fee (sponsorship_fee_bps).
 *   4. The sponsor pays through Stripe Checkout (/sponsorships/deals). With Stripe Connect on and the organizer
 *      verified, the organizer's share goes to their Stripe account with the payment; otherwise Finance pays it out
 *      by hand (Admin → Sponsorships → Approve payout, then Admin → Payouts as usual).
 *   5. A package with an ad creates a draft sponsor campaign on the event, named after the sponsor; the organizer adds
 *      the creative on the event's Sponsors tab and Fattixx approves it, as for every sponsor ad.
 */
export type PackageRow = Row & {
  id: number; organization_id: number; event_id: number | null; title: string; description: string | null; perks: string | null;
  price_cents: number; currency: string; quantity: number; sold: number; includes_ad: number; status: 'draft' | 'listed' | 'closed';
  created_at: Date; event_title: string | null; event_slug: string | null; event_starts_at: Date | null; event_timezone: string | null;
  org_name: string; org_slug: string; org_logo: string | null; venue_city: string | null; venue_region: string | null; event_category: string | null;
};

const PACKAGE_SELECT = `
  SELECT p.*, e.title AS event_title, e.slug AS event_slug, e.starts_at AS event_starts_at, e.timezone AS event_timezone, e.category AS event_category,
         g.name AS org_name, g.slug AS org_slug, g.logo_path AS org_logo, v.city AS venue_city, v.region AS venue_region
    FROM sponsorship_packages p JOIN organizations g ON g.id = p.organization_id
    LEFT JOIN events e ON e.id = p.event_id LEFT JOIN venues v ON v.id = e.venue_id`;

/** Listed, not sold out, organization active, and (for an event package) the event public and still ahead. */
const MARKETPLACE_WHERE = `p.status = 'listed' AND p.sold < p.quantity AND g.status = 'active'
  AND (p.event_id IS NULL OR (e.status IN ('published','postponed') AND e.visibility = 'public' AND e.starts_at > NOW()))`;

export async function listMarketplace(f: { q?: string; category?: string; city?: string } = {}): Promise<PackageRow[]> {
  const where = [MARKETPLACE_WHERE];
  const params: string[] = [];
  if (f.q) { where.push('(p.title LIKE ? OR g.name LIKE ? OR e.title LIKE ?)'); const like = `%${f.q.replace(/[%_]/g, '')}%`; params.push(like, like, like); }
  if (f.category) { where.push('e.category = ?'); params.push(f.category); }
  if (f.city) { where.push('v.city = ?'); params.push(f.city); }
  return query<PackageRow>(`${PACKAGE_SELECT} WHERE ${where.join(' AND ')} ORDER BY COALESCE(e.starts_at, p.created_at) ASC LIMIT 200`, params);
}

export async function getMarketplacePackage(id: number): Promise<PackageRow | null> {
  return queryOne<PackageRow>(`${PACKAGE_SELECT} WHERE p.id = ? AND ${MARKETPLACE_WHERE}`, [id]);
}

export async function getPackage(id: number): Promise<PackageRow | null> {
  return queryOne<PackageRow>(`${PACKAGE_SELECT} WHERE p.id = ?`, [id]);
}

export async function listOrgPackages(orgId: number): Promise<PackageRow[]> {
  return query<PackageRow>(`${PACKAGE_SELECT} WHERE p.organization_id = ? ORDER BY p.created_at DESC`, [orgId]);
}

export type DealRow = Row & {
  id: number; package_id: number; organization_id: number; sponsor_user_id: number | null; sponsor_name: string; contact_name: string; contact_email: string;
  website: string | null; message: string | null; status: 'requested' | 'accepted' | 'declined' | 'paid' | 'cancelled' | 'refunded';
  amount_cents: number; fee_cents: number; currency: string; connect_account_id: string | null; stripe_checkout_session: string | null; stripe_payment_intent_id: string | null;
  campaign_id: number | null; organizer_note: string | null; decided_at: Date | null; paid_at: Date | null; created_at: Date;
  package_title: string; event_id: number | null; event_title: string | null; org_name: string; org_slug: string; payout_status: string | null;
};

const DEAL_SELECT = `
  SELECT d.*, p.title AS package_title, p.event_id, e.title AS event_title, g.name AS org_name, g.slug AS org_slug,
         (SELECT po.status FROM payouts po WHERE po.sponsorship_deal_id = d.id AND po.status <> 'void' ORDER BY po.id DESC LIMIT 1) AS payout_status
    FROM sponsorship_deals d JOIN sponsorship_packages p ON p.id = d.package_id JOIN organizations g ON g.id = d.organization_id LEFT JOIN events e ON e.id = p.event_id`;

export async function getDeal(id: number): Promise<DealRow | null> {
  return queryOne<DealRow>(`${DEAL_SELECT} WHERE d.id = ?`, [id]);
}

export async function listOrgDeals(orgId: number): Promise<DealRow[]> {
  return query<DealRow>(`${DEAL_SELECT} WHERE d.organization_id = ? ORDER BY FIELD(d.status, 'requested', 'accepted', 'paid', 'declined', 'cancelled', 'refunded'), d.created_at DESC LIMIT 300`, [orgId]);
}

export async function listSponsorDeals(userId: number): Promise<DealRow[]> {
  return query<DealRow>(`${DEAL_SELECT} WHERE d.sponsor_user_id = ? ORDER BY d.created_at DESC LIMIT 200`, [userId]);
}

export async function listAllDeals(): Promise<DealRow[]> {
  return query<DealRow>(`${DEAL_SELECT} ORDER BY d.created_at DESC LIMIT 500`);
}

/** Fattixx's share of a deal, rounded to the cent. */
export function sponsorshipFeeCents(amountCents: number, feeBps: number): number {
  return Math.round((amountCents * Math.max(0, feeBps)) / 10_000);
}

/** What the organizer receives for a deal. */
export function organizerDealCents(d: { amount_cents: number; fee_cents: number }): number {
  return Math.max(0, Number(d.amount_cents) - Number(d.fee_cents));
}

/**
 * Webhook (checkout.session.completed, metadata.kind = sponsorship): mark the deal paid, count the package as sold
 * and, when it includes an ad, create the draft sponsor campaign. Only the session the deal started counts.
 */
export async function markSponsorshipPaid(sessionId: string, paymentIntentId: string | null, amountTotal: number | null, dealId: number): Promise<void> {
  const r = await execute(
    `UPDATE sponsorship_deals SET status = 'paid', paid_at = NOW(), stripe_payment_intent_id = ?
      WHERE id = ? AND status = 'accepted' AND stripe_checkout_session = ? AND amount_cents = ?`,
    [paymentIntentId, dealId, sessionId, amountTotal ?? -1],
  );
  if (!r.affectedRows) return;
  const d = await getDeal(dealId);
  if (!d) return;
  await execute(`UPDATE sponsorship_packages SET sold = sold + 1, status = IF(sold + 1 >= quantity, 'closed', status) WHERE id = ?`, [d.package_id]);
  const pkg = await getPackage(Number(d.package_id));
  if (pkg && Number(pkg.includes_ad) && pkg.event_id) {
    const destination = d.website && /^https?:\/\//.test(d.website) ? d.website : `${env.APP_URL}/events/${pkg.event_slug}`;
    const c = await execute(
      `INSERT INTO ad_campaigns (name, kind, advertiser_name, advertiser_contact, destination_url, organization_id, event_id, status, weight, priority)
       VALUES (?, 'sponsored', ?, ?, ?, ?, ?, 'draft', 1, 0)`,
      [`Sponsor: ${d.sponsor_name}`.slice(0, 160), d.sponsor_name, d.contact_email, destination.slice(0, 500), d.organization_id, pkg.event_id],
    );
    for (const placement of ['event_detail', 'order_confirmation']) await execute(`INSERT INTO ad_campaign_placements (campaign_id, placement) VALUES (?, ?)`, [c.insertId, placement]);
    await execute(`UPDATE sponsorship_deals SET campaign_id = ? WHERE id = ?`, [c.insertId, dealId]);
  }
  await audit('sponsorship.paid', { targetType: 'sponsorship_deal', targetId: dealId, metadata: { via: 'webhook', pi: paymentIntentId } });
  const amount = formatCents(Number(d.amount_cents), d.currency);
  const org = await queryOne<Row & { contact_email: string; name: string }>(`SELECT contact_email, name FROM organizations WHERE id = ?`, [d.organization_id]);
  if (org) {
    await sendNotice({ email: org.contact_email, name: org.name }, `${d.sponsor_name} paid for “${d.package_title}”`, [
      `${d.sponsor_name} paid ${amount}. Your share is ${formatCents(organizerDealCents(d), d.currency)} after the Fattixx fee${d.connect_account_id ? '; it is on its way to your Stripe account' : '; Fattixx pays it out to you'}.`,
      pkg && Number(pkg.includes_ad) && pkg.event_id ? 'A draft sponsor ad was created on the event. Add the sponsor\'s image on the event\'s Sponsors tab; Fattixx approves it before it goes live.' : `Reach out to ${d.contact_name} (${d.contact_email}) to deliver the package.`,
    ], { href: `${env.APP_URL}/org/${d.org_slug}/sponsorships`, label: 'Open sponsorships' }, { type: 'sponsorship_deal', id: dealId });
  }
  await sendNotice({ email: d.contact_email, name: d.contact_name }, `Payment received: ${d.package_title}`, [
    `Thank you. ${d.org_name} received your payment of ${amount} for “${d.package_title}”${d.event_title ? ` at ${d.event_title}` : ''}.`,
    'The organizer will be in touch about the details.',
  ], { href: `${env.APP_URL}/sponsorships/deals`, label: 'Your sponsorships' }, { type: 'sponsorship_deal', id: dealId });
  if (!d.connect_account_id) await noticeToStaff(`Sponsorship payout due: ${d.org_name}`, [`${d.sponsor_name} paid ${amount} for “${d.package_title}”. ${formatCents(organizerDealCents(d), d.currency)} is owed to ${d.org_name}.`], { href: `${env.ADMIN_URL}/admin/sponsorships`, label: 'Approve the payout' }, ['super_admin', 'finance']);
}
