'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, type OrgContext } from '../authz';
import { assertPlatformRole } from '../auth/guard';
import { getSession } from '../auth/session';
import { getEvent } from '../events/queries';
import { env } from '../env';
import { stripeReturnUrl } from '../return-url';
import { formatCents, parseDollarsToCents } from '../money';
import { connectDestinationFor } from '../payments/connect';
import { getStripe } from '../payments/stripe';
import { clientIp } from '../request';
import { BOT_MESSAGE, CAPTCHA_MESSAGE, humanCheck, rateLimited } from '../security/bot';
import { getSettings } from '../settings';
import { sendNotice } from '../simple-email';
import { isEmail } from '../users';
import { getDeal, getMarketplacePackage, getPackage, organizerDealCents, sponsorshipFeeCents } from './deals';

/** Sponsorship marketplace actions (lib/sponsorships/deals.ts). */
export type ActionState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;
const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? '').trim().slice(0, max);

function refresh(orgSlug: string, packageId?: number) {
  revalidatePath(`/org/${orgSlug}/sponsorships`);
  revalidatePath('/sponsorships');
  if (packageId) revalidatePath(`/sponsorships/${packageId}`);
  revalidatePath('/sponsorships/deals');
  revalidatePath('/admin/sponsorships');
}

// ---------------------------------------------------------------------------
// Organizer: packages
// ---------------------------------------------------------------------------
export async function savePackage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await assertOrg(str(fd, 'org', 64), 'organizer'); } catch (e) { return { error: (e as Error).message }; }
  const id = Number(fd.get('id')) || null;
  const title = str(fd, 'title', 160);
  if (title.length < 3) return { error: 'Give the package a title.', field: 'title' };
  const price = parseDollarsToCents(str(fd, 'price', 12));
  if (price === null || price < 100 || price > 10_000_000) return { error: 'Price: $1 to $100,000.', field: 'price' };
  const quantity = Math.round(Number(str(fd, 'quantity', 6)));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return { error: 'How many: 1 to 1,000.', field: 'quantity' };
  const eventId = Number(fd.get('event_id')) || null;
  if (eventId && !(await getEvent(ctx.org.id, eventId))) return { error: 'Choose one of your events.', field: 'event_id' };
  const includesAd = fd.get('includes_ad') ? 1 : 0;
  if (includesAd && !eventId) return { error: 'An on-page ad needs an event. Choose the event, or untick the ad.', field: 'includes_ad' };
  const status = ['draft', 'listed', 'closed'].includes(str(fd, 'status', 10)) ? str(fd, 'status', 10) : 'draft';
  const vals = [title, str(fd, 'description', 2000) || null, str(fd, 'perks', 2000) || null, price, quantity, includesAd, eventId, status];
  let packageId: number;
  if (id) {
    const p = await getPackage(id);
    if (!p || Number(p.organization_id) !== ctx.org.id) return { error: 'Package not found.' };
    if (quantity < Number(p.sold)) return { error: `${p.sold} of these are already sold.`, field: 'quantity' };
    await execute(`UPDATE sponsorship_packages SET title = ?, description = ?, perks = ?, price_cents = ?, quantity = ?, includes_ad = ?, event_id = ?, status = ? WHERE id = ?`, [...vals, id]);
    packageId = id;
  } else {
    const r = await execute(
      `INSERT INTO sponsorship_packages (title, description, perks, price_cents, quantity, includes_ad, event_id, status, organization_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...vals, ctx.org.id, ctx.session.user.id]);
    packageId = r.insertId;
  }
  await audit('sponsorship.package.saved', { actorUserId: ctx.session.user.id, targetType: 'sponsorship_package', targetId: packageId, metadata: { status } });
  refresh(ctx.org.slug, packageId);
  return { ok: true, message: status === 'listed' ? 'Saved and listed on the sponsorship marketplace.' : 'Saved.' };
}

export async function deletePackage(fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await assertOrg(str(fd, 'org', 64), 'organizer'); } catch (e) { return { error: (e as Error).message }; }
  const p = await getPackage(Number(fd.get('id')));
  if (!p || Number(p.organization_id) !== ctx.org.id) return { error: 'Package not found.' };
  const deals = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM sponsorship_deals WHERE package_id = ? AND status IN ('accepted','paid','refunded')`, [p.id]);
  if (Number(deals?.n)) return { error: 'This package has accepted or paid deals. Close it instead of deleting it.' };
  await execute(`DELETE FROM sponsorship_packages WHERE id = ?`, [p.id]);
  await audit('sponsorship.package.deleted', { actorUserId: ctx.session.user.id, targetType: 'sponsorship_package', targetId: p.id });
  refresh(ctx.org.slug);
  return { ok: true, message: 'Package deleted.' };
}

// ---------------------------------------------------------------------------
// Sponsor: request, pay, cancel
// ---------------------------------------------------------------------------
export async function requestSponsorship(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in first.' };
  const ip = await clientIp();
  if (rateLimited(`sponsor-request:${session.user.id}`, 10, 60 * 60_000)) return { error: 'Too many requests. Try again later.' };
  const bot = await humanCheck(fd, ip);
  if (bot) return { error: bot === 'captcha' ? CAPTCHA_MESSAGE : BOT_MESSAGE };
  const p = await getMarketplacePackage(Number(fd.get('package_id')));
  if (!p) return { error: 'This package is no longer available.' };
  const v = { sponsor: str(fd, 'sponsor_name', 160), contact: str(fd, 'contact_name', 160), email: str(fd, 'contact_email', 254).toLowerCase(), website: str(fd, 'website', 255), message: str(fd, 'message', 2000) };
  if (v.sponsor.length < 2) return { error: 'Enter the company or brand that sponsors.', field: 'sponsor_name' };
  if (v.contact.length < 2) return { error: 'Enter a contact name.', field: 'contact_name' };
  if (!isEmail(v.email)) return { error: 'Enter a valid email address.', field: 'contact_email' };
  if (v.website && !/^https?:\/\/\S+$/i.test(v.website)) return { error: 'The website must start with http:// or https://', field: 'website' };
  const open = await queryOne(`SELECT 1 FROM sponsorship_deals WHERE package_id = ? AND sponsor_user_id = ? AND status IN ('requested','accepted')`, [p.id, session.user.id]);
  if (open) return { ok: true, message: 'You already have an open request for this package. See “Your sponsorships”.' };
  const r = await execute(
    `INSERT INTO sponsorship_deals (package_id, organization_id, sponsor_user_id, sponsor_name, contact_name, contact_email, website, message, amount_cents, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.id, p.organization_id, session.user.id, v.sponsor, v.contact, v.email, v.website || null, v.message || null, p.price_cents, p.currency],
  );
  await audit('sponsorship.requested', { actorUserId: session.user.id, targetType: 'sponsorship_deal', targetId: r.insertId, metadata: { package: p.id } });
  const org = await queryOne<Row & { contact_email: string; name: string }>(`SELECT contact_email, name FROM organizations WHERE id = ?`, [p.organization_id]);
  if (org) {
    await sendNotice({ email: org.contact_email, name: org.name }, `Sponsorship request: ${v.sponsor} for “${p.title}”`, [
      `${v.contact} of ${v.sponsor} (${v.email}) would like to buy “${p.title}” for ${formatCents(Number(p.price_cents), p.currency)}.`,
      ...(v.message ? [`Their message: ${v.message}`] : []),
      'Accept or decline it in your dashboard. The sponsor pays once you accept.',
    ], { href: `${env.APP_URL}/org/${p.org_slug}/sponsorships`, label: 'Review the request' }, { type: 'sponsorship_deal', id: r.insertId });
  }
  refresh(p.org_slug, p.id);
  return { ok: true, message: `Request sent to ${p.org_name}. You will get an email when they reply, with a link to pay.` };
}

/** Sponsor: pay an accepted deal through Stripe Checkout. */
export async function payDeal(fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  const d = await getDeal(Number(fd.get('id')));
  if (!d || Number(d.sponsor_user_id) !== session.user.id) return { error: 'Sponsorship not found.' };
  if (d.status !== 'accepted') return { error: d.status === 'paid' ? 'This sponsorship is already paid.' : 'The organizer has not accepted this request.' };
  let url: string;
  try {
    const { stripe, active } = await getStripe();
    // Stripe Connect: the organizer's share goes to their account with the payment.
    const destination = await connectDestinationFor(Number(d.organization_id), active.mode);
    const share = organizerDealCents(d);
    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: d.contact_email,
      client_reference_id: `sponsorship:${d.id}`,
      line_items: [{ quantity: 1, price_data: { currency: d.currency.toLowerCase(), unit_amount: Number(d.amount_cents), product_data: { name: `Sponsorship: ${d.package_title}`.slice(0, 250), description: `${d.org_name}${d.event_title ? ` · ${d.event_title}` : ''}`.slice(0, 500) } } }],
      metadata: { kind: 'sponsorship', deal_id: String(d.id), organization_id: String(d.organization_id) },
      payment_intent_data: {
        metadata: { kind: 'sponsorship', deal_id: String(d.id) },
        description: `Sponsorship ${d.id}: ${d.sponsor_name} → ${d.org_name}`.slice(0, 500),
        ...(destination && share > 0 ? { transfer_data: { destination, amount: share }, transfer_group: `sponsorship-${d.id}` } : {}),
      },
      success_url: stripeReturnUrl(`/sponsorships/deals?paid=${d.id}`),
      cancel_url: stripeReturnUrl('/sponsorships/deals'),
    });
    if (!checkout.url) throw new Error('Stripe did not return a checkout page.');
    await execute(`UPDATE sponsorship_deals SET stripe_checkout_session = ?, connect_account_id = ? WHERE id = ? AND status = 'accepted'`, [checkout.id, destination && share > 0 ? destination : null, d.id]);
    url = checkout.url;
  } catch (e) {
    return { error: `Payment could not be started: ${(e as Error).message}` };
  }
  redirect(url);
}

/** Sponsor (their own open request) or Organization Admin: cancel before payment. */
export async function cancelDeal(fd: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  const d = await getDeal(Number(fd.get('id')));
  if (!d) return { error: 'Sponsorship not found.' };
  const isSponsor = Number(d.sponsor_user_id) === session.user.id;
  if (!isSponsor) {
    try { await assertOrg(d.org_slug, 'org_admin'); } catch { return { error: 'Sponsorship not found.' }; }
  }
  const r = await execute(`UPDATE sponsorship_deals SET status = 'cancelled' WHERE id = ? AND status IN ('requested','accepted')`, [d.id]);
  if (!r.affectedRows) return { error: 'Only requests that are not paid yet can be cancelled.' };
  await audit('sponsorship.cancelled', { actorUserId: session.user.id, targetType: 'sponsorship_deal', targetId: d.id, metadata: { by: isSponsor ? 'sponsor' : 'organizer' } });
  if (!isSponsor) await sendNotice({ email: d.contact_email, name: d.contact_name }, `Sponsorship cancelled: ${d.package_title}`, [`${d.org_name} cancelled your sponsorship request for “${d.package_title}”. Nothing was charged.`], undefined, { type: 'sponsorship_deal', id: d.id });
  refresh(d.org_slug, Number(d.package_id));
  return { ok: true, message: 'Cancelled.' };
}

// ---------------------------------------------------------------------------
// Organization Admin: accept / decline
// ---------------------------------------------------------------------------
export async function decideDeal(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await assertOrg(str(fd, 'org', 64), 'org_admin'); } catch (e) { return { error: (e as Error).message }; }
  const d = await getDeal(Number(fd.get('id')));
  if (!d || Number(d.organization_id) !== ctx.org.id) return { error: 'Request not found.' };
  if (d.status !== 'requested') return { error: 'This request was already answered.' };
  const decision = str(fd, 'decision', 10);
  if (decision !== 'accept' && decision !== 'decline') return { error: 'Accept or decline.' };
  const note = str(fd, 'note', 1000) || null;
  if (decision === 'accept') {
    const p = await getPackage(Number(d.package_id));
    if (!p || Number(p.sold) >= Number(p.quantity)) return { error: 'This package is sold out.' };
    const fee = sponsorshipFeeCents(Number(d.amount_cents), Number((await getSettings()).sponsorship_fee_bps) || 0);
    await execute(`UPDATE sponsorship_deals SET status = 'accepted', fee_cents = ?, organizer_note = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'requested'`, [fee, note, ctx.session.user.id, d.id]);
    await sendNotice({ email: d.contact_email, name: d.contact_name }, `${d.org_name} accepted your sponsorship`, [
      `${d.org_name} accepted your request for “${d.package_title}” (${formatCents(Number(d.amount_cents), d.currency)}).`,
      ...(note ? [`Their note: ${note}`] : []),
      'Pay securely by card to confirm it.',
    ], { href: `${env.APP_URL}/sponsorships/deals`, label: 'Pay now' }, { type: 'sponsorship_deal', id: d.id });
  } else {
    await execute(`UPDATE sponsorship_deals SET status = 'declined', organizer_note = ?, decided_by = ?, decided_at = NOW() WHERE id = ? AND status = 'requested'`, [note, ctx.session.user.id, d.id]);
    await sendNotice({ email: d.contact_email, name: d.contact_name }, `About your sponsorship request to ${d.org_name}`, [
      `${d.org_name} declined your request for “${d.package_title}”.`, ...(note ? [`Their note: ${note}`] : []),
    ], { href: `${env.APP_URL}/sponsorships`, label: 'See other opportunities' }, { type: 'sponsorship_deal', id: d.id });
  }
  await audit('sponsorship.decided', { actorUserId: ctx.session.user.id, targetType: 'sponsorship_deal', targetId: d.id, metadata: { decision } });
  refresh(ctx.org.slug, Number(d.package_id));
  return { ok: true, message: decision === 'accept' ? 'Accepted. The sponsor has been asked to pay.' : 'Declined.' };
}

// ---------------------------------------------------------------------------
// Finance / Super Admin: manual payout of a paid deal (deals paid without Stripe Connect), refunds
// ---------------------------------------------------------------------------
export async function approveSponsorshipPayout(fd: FormData): Promise<ActionState> {
  let session;
  try { session = await assertPlatformRole(['super_admin', 'finance']); } catch (e) { return { error: (e as Error).message }; }
  const d = await getDeal(Number(fd.get('id')));
  if (!d || d.status !== 'paid') return { error: 'Only paid sponsorships can be paid out.' };
  if (d.connect_account_id) return { error: 'This sponsorship was paid out automatically through Stripe Connect.' };
  if (d.payout_status) return { error: 'A payout for this sponsorship already exists.' };
  await execute(
    `INSERT INTO payouts (organization_id, event_id, sponsorship_deal_id, amount_cents, currency, status, notes, approved_by) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)`,
    [d.organization_id, d.event_id, d.id, organizerDealCents(d), d.currency, `Sponsorship: ${d.sponsor_name} · ${d.package_title}`.slice(0, 500), session.user.id],
  );
  await audit('payout.approved', { actorUserId: session.user.id, targetType: 'sponsorship_deal', targetId: d.id, metadata: { amount: organizerDealCents(d) } });
  refresh(d.org_slug);
  revalidatePath('/admin/payouts');
  return { ok: true, message: 'Payout approved. Mark it paid in Admin → Payouts once sent.' };
}

export async function refundDeal(fd: FormData): Promise<ActionState> {
  let session;
  try { session = await assertPlatformRole(['super_admin', 'finance']); } catch (e) { return { error: (e as Error).message }; }
  const d = await getDeal(Number(fd.get('id')));
  if (!d || d.status !== 'paid' || !d.stripe_payment_intent_id) return { error: 'Only paid sponsorships can be refunded.' };
  if (d.payout_status === 'paid') return { error: 'The organizer was already paid for this sponsorship by hand. Recover that first, then refund in Stripe.' };
  try {
    const { stripe } = await getStripe();
    await stripe.refunds.create({ payment_intent: d.stripe_payment_intent_id, ...(d.connect_account_id ? { reverse_transfer: true } : {}), metadata: { kind: 'sponsorship', deal_id: String(d.id) } }, { idempotencyKey: `sponsorship-refund-${d.id}` });
  } catch (e) {
    return { error: `Stripe refused the refund: ${(e as Error).message}` };
  }
  await execute(`UPDATE sponsorship_deals SET status = 'refunded' WHERE id = ?`, [d.id]);
  await execute(`UPDATE sponsorship_packages SET sold = GREATEST(sold, 1) - 1 WHERE id = ?`, [d.package_id]);
  await execute(`UPDATE payouts SET status = 'void' WHERE sponsorship_deal_id = ? AND status = 'approved'`, [d.id]);
  if (d.campaign_id) await execute(`UPDATE ad_campaigns SET status = 'paused' WHERE id = ?`, [d.campaign_id]);
  await audit('sponsorship.refunded', { actorUserId: session.user.id, targetType: 'sponsorship_deal', targetId: d.id });
  await sendNotice({ email: d.contact_email, name: d.contact_name }, `Refund: ${d.package_title}`, [`Your payment of ${formatCents(Number(d.amount_cents), d.currency)} for “${d.package_title}” was refunded. It reaches your card in 5–10 business days.`], undefined, { type: 'sponsorship_deal', id: d.id });
  refresh(d.org_slug, Number(d.package_id));
  return { ok: true, message: 'Refunded.' };
}
