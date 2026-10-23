'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { getSession } from '../auth/session';
import { env } from '../env';
import { getStripe } from '../payments/stripe';
import { clientIp } from '../request';
import { BOT_MESSAGE, CAPTCHA_MESSAGE, humanCheck, rateLimited } from '../security/bot';
import { getSettings } from '../settings';
import { noticeToStaff, sendNotice } from '../simple-email';
import { isEmail } from '../users';
import { advertiserForUser, approvedAdvertiser } from './advertisers';
import { impressionPriceCents } from './placements';

/** Self-service advertiser portal actions (lib/ads/advertisers.ts). Campaign editing itself is in ./actions.ts. */
export type ActionState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;
const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? '').trim().slice(0, max);

export async function applyAsAdvertiser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in first.' };
  const ip = await clientIp();
  if (rateLimited(`advertiser-apply:${ip}`, 5, 60 * 60_000)) return { error: 'Too many attempts. Try again later.' };
  const bot = await humanCheck(fd, ip);
  if (bot) return { error: bot === 'captcha' ? CAPTCHA_MESSAGE : BOT_MESSAGE };
  const v = { company: str(fd, 'company_name', 160), contact: str(fd, 'contact_name', 160), email: str(fd, 'contact_email', 254).toLowerCase(), website: str(fd, 'website', 255) };
  if (v.company.length < 2) return { error: 'Enter your company or brand name.', field: 'company_name' };
  if (v.contact.length < 2) return { error: 'Enter a contact name.', field: 'contact_name' };
  if (!isEmail(v.email)) return { error: 'Enter a valid email address.', field: 'contact_email' };
  if (v.website && !/^https?:\/\/\S+$/i.test(v.website)) return { error: 'The website must start with http:// or https://', field: 'website' };
  if (!fd.get('agree')) return { error: 'Please accept the advertising terms.', field: 'agree' };
  const existing = await advertiserForUser(session.user.id);
  if (existing && existing.status !== 'rejected') return { ok: true, message: existing.status === 'approved' ? 'Your advertiser account is already approved.' : 'Your application is already in review.' };
  if (existing) {
    await execute(`UPDATE advertisers SET company_name = ?, contact_name = ?, contact_email = ?, website = ?, status = 'pending', review_notes = NULL WHERE id = ?`, [v.company, v.contact, v.email, v.website || null, existing.id]);
  } else {
    await execute(`INSERT INTO advertisers (user_id, company_name, contact_name, contact_email, website) VALUES (?, ?, ?, ?, ?)`, [session.user.id, v.company, v.contact, v.email, v.website || null]);
  }
  await audit('advertiser.applied', { actorUserId: session.user.id, metadata: { company: v.company } });
  await noticeToStaff(`New advertiser application: ${v.company}`, [`${v.contact} (${v.email}) applied to advertise on Fattixx${v.website ? `. Website: ${v.website}` : ''}.`], { href: `${env.ADMIN_URL}/admin/advertisers`, label: 'Review applications' });
  revalidatePath('/advertise');
  return { ok: true, message: 'Thanks! We review new advertisers within one to two business days and will email you.' };
}

/** Super Admin: approve, reject or suspend an advertiser. Suspending pauses their live campaigns. */
export async function reviewAdvertiser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let session;
  try { session = await assertSuperAdmin(); } catch (e) { return { error: (e as Error).message }; }
  const id = Number(fd.get('id'));
  const status = str(fd, 'status', 12);
  if (!['approved', 'rejected', 'suspended'].includes(status)) return { error: 'Unknown status.' };
  const adv = await queryOne<Row & { id: number; contact_email: string; contact_name: string; company_name: string }>(`SELECT id, contact_email, contact_name, company_name FROM advertisers WHERE id = ?`, [id]);
  if (!adv) return { error: 'Advertiser not found.' };
  const notes = str(fd, 'notes', 1000) || null;
  await execute(`UPDATE advertisers SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`, [status, notes, session.user.id, id]);
  if (status !== 'approved') await execute(`UPDATE ad_campaigns SET status = 'paused' WHERE advertiser_id = ? AND status = 'active'`, [id]);
  await audit('advertiser.reviewed', { actorUserId: session.user.id, targetType: 'advertiser', targetId: id, metadata: { status } });
  const lines = status === 'approved'
    ? [`Good news: ${adv.company_name} can now advertise on Fattixx.`, 'Build a campaign, add your creative, choose how many impressions to buy, and submit it for review.']
    : status === 'rejected'
      ? [`We could not approve ${adv.company_name} as an advertiser this time.`, ...(notes ? [`Reason: ${notes}`] : [])]
      : [`Advertising for ${adv.company_name} is suspended and your live campaigns are paused.`, ...(notes ? [`Reason: ${notes}`] : [])];
  await sendNotice({ email: adv.contact_email, name: adv.contact_name }, status === 'approved' ? 'Your Fattixx advertiser account is approved' : 'About your Fattixx advertiser account', lines,
    status === 'approved' ? { href: `${env.APP_URL}/advertiser`, label: 'Open the advertiser portal' } : undefined, { type: 'advertiser', id });
  revalidatePath('/admin/advertisers');
  return { ok: true, message: `Advertiser ${status}.` };
}

/** Advertiser: buy impressions for an unpaid campaign through Stripe Checkout. The webhook submits it for review. */
export async function buyImpressions(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  const adv = await approvedAdvertiser(session.user.id);
  if (!adv) return { error: 'Your advertiser account is not approved.' };
  const id = Number(fd.get('campaign_id'));
  const c = await queryOne<Row & { id: number; name: string; payment_status: string | null; creatives: number; placements: number }>(
    `SELECT c.id, c.name, c.payment_status, (SELECT COUNT(*) FROM ad_creatives cr WHERE cr.campaign_id = c.id) AS creatives,
            (SELECT COUNT(*) FROM ad_campaign_placements p WHERE p.campaign_id = c.id) AS placements
       FROM ad_campaigns c WHERE c.id = ? AND c.advertiser_id = ?`, [id, adv.id]);
  if (!c) return { error: 'Campaign not found.' };
  if (c.payment_status === 'paid') return { error: 'This campaign is already paid for.' };
  if (!Number(c.creatives)) return { error: 'Add at least one creative first.' };
  if (!Number(c.placements)) return { error: 'Choose at least one placement first.' };
  const s = await getSettings();
  const min = Number(s.ad_min_impressions) || 5000;
  const impressions = Math.round(Number(str(fd, 'impressions', 12)));
  if (!Number.isInteger(impressions) || impressions < min || impressions > 50_000_000) return { error: `Buy at least ${min.toLocaleString()} impressions.`, field: 'impressions' };
  const price = impressionPriceCents(impressions, Number(s.ad_cpm_cents) || 1000);
  let url: string;
  try {
    const { stripe } = await getStripe();
    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: adv.contact_email,
      client_reference_id: `ad_campaign:${c.id}`,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: price, product_data: { name: `Fattixx ad campaign: ${c.name}`.slice(0, 250), description: `${impressions.toLocaleString()} impressions` } } }],
      metadata: { kind: 'ad_campaign', campaign_id: String(c.id), impressions: String(impressions), advertiser_id: String(adv.id) },
      payment_intent_data: { metadata: { kind: 'ad_campaign', campaign_id: String(c.id) }, description: `Ad campaign ${c.id} (${adv.company_name})` },
      success_url: `${env.APP_URL}/advertiser/campaigns/${c.id}?paid=1`,
      cancel_url: `${env.APP_URL}/advertiser/campaigns/${c.id}`,
    });
    if (!checkout.url) throw new Error('Stripe did not return a checkout page.');
    await execute(`UPDATE ad_campaigns SET impressions_cap = ?, price_cents = ?, stripe_checkout_session = ? WHERE id = ? AND (payment_status IS NULL OR payment_status = 'unpaid')`, [impressions, price, checkout.id, c.id]);
    url = checkout.url;
  } catch (e) {
    return { error: `Payment could not be started: ${(e as Error).message}` };
  }
  await audit('ad.checkout.started', { actorUserId: session.user.id, targetType: 'ad_campaign', targetId: c.id, metadata: { impressions, price } });
  redirect(url);
}

/** Super Admin: reject a paid advertiser campaign and refund it in full (or note why for an unpaid one). */
export async function rejectAdvertiserCampaign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let session;
  try { session = await assertSuperAdmin(); } catch (e) { return { error: (e as Error).message }; }
  const id = Number(fd.get('id'));
  const notes = str(fd, 'notes', 1000);
  if (notes.length < 3) return { error: 'Tell the advertiser why.' };
  const c = await queryOne<Row & { id: number; name: string; payment_status: string | null; stripe_payment_intent_id: string | null; impressions_served: number; contact_email: string; contact_name: string }>(
    `SELECT c.id, c.name, c.payment_status, c.stripe_payment_intent_id, c.impressions_served, a.contact_email, a.contact_name
       FROM ad_campaigns c JOIN advertisers a ON a.id = c.advertiser_id WHERE c.id = ?`, [id]);
  if (!c) return { error: 'Advertiser campaign not found.' };
  let refunded = false;
  if (c.payment_status === 'paid' && c.stripe_payment_intent_id) {
    if (Number(c.impressions_served) > 0) return { error: 'This campaign has already served impressions. Pause it and refund the unused part in Stripe instead.' };
    try {
      const { stripe } = await getStripe();
      await stripe.refunds.create({ payment_intent: c.stripe_payment_intent_id, metadata: { kind: 'ad_campaign', campaign_id: String(c.id) } }, { idempotencyKey: `ad-refund-${c.id}` });
      refunded = true;
    } catch (e) {
      return { error: `Stripe refused the refund: ${(e as Error).message}` };
    }
  }
  await execute(`UPDATE ad_campaigns SET status = 'draft', review_status = 'rejected', review_notes = ?, payment_status = IF(?, 'refunded', payment_status) WHERE id = ?`, [notes, refunded ? 1 : 0, id]);
  await audit(refunded ? 'ad.refunded' : 'ad.reviewed', { actorUserId: session.user.id, targetType: 'ad_campaign', targetId: id, metadata: { rejected: true, refunded } });
  await sendNotice({ email: c.contact_email, name: c.contact_name }, `Your campaign “${c.name}” was not approved`,
    [`Reason: ${notes}`, refunded ? 'Your payment has been refunded in full; it reaches your card in 5–10 business days.' : 'You can edit it and submit it again.'],
    { href: `${env.APP_URL}/advertiser/campaigns/${id}`, label: 'Open the campaign' }, { type: 'ad_campaign', id });
  revalidatePath(`/admin/ads/${id}`);
  revalidatePath('/admin/ads');
  return { ok: true, message: refunded ? 'Rejected and refunded.' : 'Rejected.' };
}
