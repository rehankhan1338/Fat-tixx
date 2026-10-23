import 'server-only';
import type Stripe from 'stripe';
import { execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { sendEmail } from '../email';
import { renderEmail, type TemplateKey } from '../email-templates';
import { formatCents } from '../money';
import { getActiveStripe, getStripe, stripeClient } from '../payments/stripe';
import { getSettingValue } from '../settings';
import { PRO_MONTHLY_CENTS, PRO_YEARLY_CENTS } from '../home/pro';
import { DEFAULT_GRACE_DAYS, isProActive, proState, proUntil, type BillingInterval, type ProState, type SubscriptionSnapshot, type SubscriptionStatus } from './status';

/**
 * Fattixx Pro billing (plan 5.7.1–5.7.2). Organizations pay through Stripe Checkout (subscription mode) on the platform's
 * Stripe account; Stripe keeps the subscription and retries failed renewals, and the webhook mirrors it into
 * `org_subscriptions`. `organizations.pro_until` is recomputed from that row (lib/pro/status.ts) after every change, so
 * every Pro check on a page is one indexed column.
 */
export type SubscriptionRow = Row & SubscriptionSnapshot & {
  organization_id: number; stripe_mode: 'test' | 'live'; stripe_customer_id: string | null; stripe_subscription_id: string | null;
  current_period_start: Date | null; canceled_at: Date | null; grace_reminder_sent_at: Date | null; ended_notice_sent_at: Date | null; created_at: Date;
};

export const PRICE_CENTS: Record<BillingInterval, number> = { month: PRO_MONTHLY_CENTS, year: PRO_YEARLY_CENTS };

export async function getSubscription(orgId: number): Promise<SubscriptionRow | null> {
  return queryOne<SubscriptionRow>(`SELECT * FROM org_subscriptions WHERE organization_id = ?`, [orgId]);
}

export async function graceDays(): Promise<number> {
  const v = Number(await getSettingValue('pro_grace_days'));
  return Number.isInteger(v) && v >= 0 && v <= 60 ? v : DEFAULT_GRACE_DAYS;
}

/** Store the organization's `pro_until` from its subscription and complimentary grant. Returns it. */
export async function recomputeProUntil(orgId: number): Promise<Date | null> {
  const [sub, org, grace] = await Promise.all([
    getSubscription(orgId),
    queryOne<Row & { pro_comp_until: Date | null }>(`SELECT pro_comp_until FROM organizations WHERE id = ?`, [orgId]),
    graceDays(),
  ]);
  const until = proUntil(sub, org?.pro_comp_until ?? null, grace);
  await execute(`UPDATE organizations SET pro_until = ? WHERE id = ?`, [until, orgId]);
  return until;
}

/** Plan status for the dashboard. */
export async function orgProState(org: { id: number; pro_comp_until?: Date | null }): Promise<{ state: ProState; sub: SubscriptionRow | null; grace: number }> {
  const [sub, grace, comp] = await Promise.all([
    getSubscription(org.id),
    graceDays(),
    org.pro_comp_until !== undefined ? Promise.resolve(org.pro_comp_until) : queryOne<Row & { pro_comp_until: Date | null }>(`SELECT pro_comp_until FROM organizations WHERE id = ?`, [org.id]).then((r) => r?.pro_comp_until ?? null),
  ]);
  return { state: proState(sub, comp, grace), sub, grace };
}

/** Is the organization on Pro right now? One indexed column (organizations.pro_until). */
export async function isOrgPro(orgId: number): Promise<boolean> {
  const r = await queryOne<Row & { pro_until: Date | null }>(`SELECT pro_until FROM organizations WHERE id = ?`, [orgId]);
  return isProActive(r?.pro_until);
}

// ---------------------------------------------------------------------------
// Stripe prices: one recurring price per interval, found by lookup key so test and live accounts each get their own,
// and a price change in lib/home/pro.ts creates a new price instead of reusing the old one.
// ---------------------------------------------------------------------------
const lookupKey = (interval: BillingInterval) => `fattixx_pro_${interval}_${PRICE_CENTS[interval]}`;

export async function ensureProPrice(stripe: Stripe, interval: BillingInterval): Promise<string> {
  const key = lookupKey(interval);
  const found = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const other = await stripe.prices.list({ lookup_keys: [lookupKey(interval === 'month' ? 'year' : 'month')], limit: 1, expand: ['data.product'] });
  const product = other.data[0]?.product;
  const price = await stripe.prices.create({
    currency: 'usd', unit_amount: PRICE_CENTS[interval], recurring: { interval }, lookup_key: key, nickname: `Fattixx Pro (${interval}ly)`,
    ...(product && typeof product !== 'string' && !product.deleted ? { product: product.id } : { product_data: { name: 'Fattixx Pro' } }),
  });
  return price.id;
}

/** Stripe customer for the organization (reused across subscriptions in the same Stripe mode). */
async function customerFor(stripe: Stripe, mode: 'test' | 'live', org: { id: number; name: string; legal_name: string | null; contact_email: string }): Promise<string> {
  const sub = await getSubscription(org.id);
  if (sub?.stripe_customer_id && sub.stripe_mode === mode) return sub.stripe_customer_id;
  const c = await stripe.customers.create({
    email: org.contact_email, name: org.legal_name || org.name, metadata: { organization_id: String(org.id), kind: 'fattixx_pro' },
  }, { idempotencyKey: `pro-customer-${org.id}-${mode}` });
  return c.id;
}

const proPageUrl = (slug: string, q = '') => `${env.APP_URL}/org/${slug}/pro${q}`;

/** Checkout page for a new subscription. */
export async function createProCheckout(org: { id: number; slug: string; name: string; legal_name: string | null; contact_email: string }, interval: BillingInterval, userId: number): Promise<string> {
  const { stripe, active } = await getStripe();
  const price = await ensureProPrice(stripe, interval);
  const customer = await customerFor(stripe, active.mode, org);
  await execute(
    `INSERT INTO org_subscriptions (organization_id, billing_interval, status, stripe_mode, stripe_customer_id, started_by) VALUES (?, ?, 'incomplete', ?, ?, ?)
     ON DUPLICATE KEY UPDATE stripe_customer_id = VALUES(stripe_customer_id), stripe_mode = VALUES(stripe_mode),
       billing_interval = IF(status IN ('active','trialing','past_due'), billing_interval, VALUES(billing_interval)), started_by = VALUES(started_by)`,
    [org.id, interval, active.mode, customer, userId],
  );
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: String(org.id),
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { organization_id: String(org.id), kind: 'fattixx_pro' }, description: `Fattixx Pro for ${org.name}` },
    metadata: { organization_id: String(org.id), kind: 'fattixx_pro' },
    success_url: proPageUrl(org.slug, '?checkout=success&session_id={CHECKOUT_SESSION_ID}'),
    cancel_url: proPageUrl(org.slug, '?checkout=cancelled'),
  });
  if (!session.url) throw new Error('Stripe did not return a checkout page.');
  return session.url;
}

/** After the organizer returns from Checkout: read the session's subscription now instead of waiting for the webhook. */
export async function syncCheckoutSession(orgId: number, sessionId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  const { stripe } = await getStripe();
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
  if (s.metadata?.organization_id !== String(orgId) || !s.subscription || typeof s.subscription === 'string') return;
  await syncSubscription(s.subscription);
}

/** Organizer-facing actions on the live subscription. */
async function liveSubscription(orgId: number): Promise<{ stripe: Stripe; sub: SubscriptionRow }> {
  const sub = await getSubscription(orgId);
  if (!sub?.stripe_subscription_id || !['active', 'trialing', 'past_due'].includes(sub.status)) throw new Error('There is no active Pro subscription.');
  const active = await getActiveStripe();
  if (!active) throw new Error('Payments are not set up yet.');
  if (active.mode !== sub.stripe_mode) throw new Error(`This subscription was made in Stripe ${sub.stripe_mode} mode, but payments are now in ${active.mode} mode. Contact support.`);
  return { stripe: stripeClient(active.secretKey), sub };
}

export async function setCancelAtPeriodEnd(orgId: number, cancel: boolean): Promise<void> {
  const { stripe, sub } = await liveSubscription(orgId);
  await syncSubscription(await stripe.subscriptions.update(sub.stripe_subscription_id!, { cancel_at_period_end: cancel }));
}

/** Monthly ↔ yearly. Stripe prorates: the unused part of the current period is credited on the next invoice. */
export async function switchInterval(orgId: number, interval: BillingInterval): Promise<void> {
  const { stripe, sub } = await liveSubscription(orgId);
  if (sub.billing_interval === interval) return;
  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id!);
  const item = current.items.data[0];
  if (!item) throw new Error('The subscription has no plan item.');
  const price = await ensureProPrice(stripe, interval);
  await syncSubscription(await stripe.subscriptions.update(current.id, {
    items: [{ id: item.id, price }], proration_behavior: 'create_prorations', cancel_at_period_end: false,
  }));
}

/**
 * Where the organizer updates their card: Stripe's customer portal when it is set up for the account, otherwise a
 * Checkout page in setup mode (the webhook then makes the new card the default and retries an unpaid invoice).
 */
export async function paymentMethodUrl(org: { id: number; slug: string }): Promise<string> {
  const { stripe, sub } = await liveSubscription(org.id);
  try {
    const portal = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id!, return_url: proPageUrl(org.slug) });
    return portal.url;
  } catch {
    const s = await stripe.checkout.sessions.create({
      mode: 'setup', customer: sub.stripe_customer_id!, currency: 'usd', payment_method_types: ['card'],
      metadata: { organization_id: String(org.id), kind: 'fattixx_pro_card', subscription: sub.stripe_subscription_id! },
      success_url: proPageUrl(org.slug, '?card=updated'), cancel_url: proPageUrl(org.slug),
    });
    if (!s.url) throw new Error('Stripe did not return a page.');
    return s.url;
  }
}

// ---------------------------------------------------------------------------
// Webhook side
// ---------------------------------------------------------------------------
const ts = (n: number | null | undefined) => (n ? new Date(n * 1000) : null);
const KNOWN: SubscriptionStatus[] = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused'];

async function orgIdForSubscription(s: Stripe.Subscription): Promise<number | null> {
  const fromMeta = Number(s.metadata?.organization_id);
  if (fromMeta) return fromMeta;
  const customer = typeof s.customer === 'string' ? s.customer : s.customer.id;
  const r = await queryOne<Row & { organization_id: number }>(`SELECT organization_id FROM org_subscriptions WHERE stripe_subscription_id = ? OR stripe_customer_id = ? LIMIT 1`, [s.id, customer]);
  return r ? Number(r.organization_id) : null;
}

/** Mirror a Stripe subscription into org_subscriptions, recompute Pro and tell the organization about changes. Idempotent. */
export async function syncSubscription(s: Stripe.Subscription): Promise<number | null> {
  if (s.metadata?.kind && s.metadata.kind !== 'fattixx_pro') return null;
  const orgId = await orgIdForSubscription(s);
  if (!orgId) return null;
  const before = await getSubscription(orgId);
  // A webhook for an older subscription (replaced by a newer one) must not overwrite the current row.
  if (before?.stripe_subscription_id && before.stripe_subscription_id !== s.id && ['active', 'trialing', 'past_due'].includes(before.status) && !['active', 'trialing', 'past_due'].includes(s.status)) return orgId;
  const item = s.items.data[0];
  const interval: BillingInterval = item?.price?.recurring?.interval === 'year' ? 'year' : 'month';
  const status: SubscriptionStatus = KNOWN.includes(s.status as SubscriptionStatus) ? (s.status as SubscriptionStatus) : 'incomplete';
  const customer = typeof s.customer === 'string' ? s.customer : s.customer.id;
  const pastDueSince = status === 'past_due' ? (before?.status === 'past_due' && before.past_due_since ? new Date(before.past_due_since) : new Date()) : null;
  const endedAt = status === 'canceled' ? ts(s.ended_at) ?? new Date() : null;
  const live = status === 'active' || status === 'trialing';
  await execute(
    `INSERT INTO org_subscriptions (organization_id, billing_interval, status, stripe_mode, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end,
        cancel_at_period_end, past_due_since, canceled_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE billing_interval = VALUES(billing_interval), status = VALUES(status), stripe_customer_id = VALUES(stripe_customer_id),
       stripe_mode = VALUES(stripe_mode), stripe_subscription_id = VALUES(stripe_subscription_id), current_period_start = VALUES(current_period_start),
       current_period_end = VALUES(current_period_end), cancel_at_period_end = VALUES(cancel_at_period_end), past_due_since = VALUES(past_due_since),
       canceled_at = VALUES(canceled_at), ended_at = VALUES(ended_at),
       grace_reminder_sent_at = IF(VALUES(status) = 'past_due', grace_reminder_sent_at, NULL),
       ended_notice_sent_at = IF(VALUES(status) IN ('active','trialing'), NULL, ended_notice_sent_at)`,
    [orgId, interval, status, s.livemode ? 'live' : 'test', customer, s.id, ts(item?.current_period_start), ts(item?.current_period_end),
     s.cancel_at_period_end ? 1 : 0, pastDueSince, ts(s.canceled_at), endedAt],
  );
  await recomputeProUntil(orgId);

  const wasLive = !!before && (before.status === 'active' || before.status === 'trialing');
  if (live && !wasLive && before?.status !== 'past_due') await notifyOrgAdmins(orgId, 'pro_activated', { interval: interval === 'year' ? 'yearly' : 'monthly' });
  if (status === 'past_due' && before?.status !== 'past_due') {
    const grace = await graceDays();
    await notifyOrgAdmins(orgId, 'pro_payment_failed', { grace_days: String(grace), grace_end: fmtDate(new Date(Date.now() + grace * 86_400_000)) });
  }
  return orgId;
}

/** Billing history row; a failed invoice also starts the grace period if the subscription event has not yet. */
export async function syncInvoice(inv: Stripe.Invoice): Promise<void> {
  const subRef = inv.parent?.subscription_details?.subscription;
  const subId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subId || !inv.id) return;
  const row = await queryOne<Row & { organization_id: number }>(`SELECT organization_id FROM org_subscriptions WHERE stripe_subscription_id = ?`, [subId]);
  if (!row) return;
  const line = inv.lines?.data?.[0];
  await execute(
    `INSERT INTO org_invoices (organization_id, stripe_invoice_id, number, status, amount_due_cents, amount_paid_cents, currency, period_start, period_end, hosted_url, pdf_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE number = VALUES(number), status = VALUES(status), amount_due_cents = VALUES(amount_due_cents), amount_paid_cents = VALUES(amount_paid_cents),
       hosted_url = VALUES(hosted_url), pdf_url = VALUES(pdf_url)`,
    [row.organization_id, inv.id, inv.number ?? null, inv.status ?? 'open', inv.amount_due ?? 0, inv.amount_paid ?? 0, (inv.currency ?? 'usd').toUpperCase(),
     ts(line?.period?.start), ts(line?.period?.end), inv.hosted_invoice_url ?? null, inv.invoice_pdf ?? null, ts(inv.created) ?? new Date()],
  );
}

/** Setup-mode Checkout finished (card update): make the card the default and retry an open invoice. */
export async function applyNewPaymentMethod(session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.kind !== 'fattixx_pro_card' || !session.setup_intent) return;
  const { stripe } = await getStripe();
  const si = typeof session.setup_intent === 'string' ? await stripe.setupIntents.retrieve(session.setup_intent) : session.setup_intent;
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
  const subId = session.metadata.subscription;
  if (!pm || !subId) return;
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (customer) await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  const sub = await stripe.subscriptions.update(subId, { default_payment_method: pm });
  const latest = typeof sub.latest_invoice === 'string' ? await stripe.invoices.retrieve(sub.latest_invoice) : sub.latest_invoice;
  if (latest?.id && latest.status === 'open') {
    try { await stripe.invoices.pay(latest.id, { payment_method: pm }); } catch { /* the webhook reports the outcome either way */ }
  }
  await syncSubscription(await stripe.subscriptions.retrieve(subId));
}

// ---------------------------------------------------------------------------
// Notices to the organization
// ---------------------------------------------------------------------------
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'America/New_York' });

/** Active Organization Admins plus the organization's contact address, each once. */
export async function orgAdminRecipients(orgId: number): Promise<{ email: string; name: string | null }[]> {
  const rows = await query<Row & { email: string; name: string | null }>(
    `SELECT u.email, u.name FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.role = 'org_admin' AND u.status = 'active'
     UNION SELECT contact_email AS email, name FROM organizations WHERE id = ?`, [orgId, orgId],
  );
  const seen = new Set<string>();
  return rows.filter((r) => r.email && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase()));
}

export async function notifyOrgAdmins(orgId: number, key: Extract<TemplateKey, `pro_${string}`>, vars: Record<string, string>): Promise<void> {
  try {
    const org = await queryOne<Row & { name: string; slug: string }>(`SELECT name, slug FROM organizations WHERE id = ?`, [orgId]);
    if (!org) return;
    const mail = await renderEmail(key, {
      org_name: org.name, url: proPageUrl(org.slug), monthly: formatCents(PRO_MONTHLY_CENTS), yearly: formatCents(PRO_YEARLY_CENTS), ...vars,
    });
    for (const r of await orgAdminRecipients(orgId)) {
      await sendEmail({ to: r.email, toName: r.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organization', id: orgId } });
    }
  } catch (e) {
    console.error('[pro] notice failed', key, e); // a failed notice must not make Stripe retry the webhook
  }
}

/**
 * Once a day: recompute every Pro organization's status (catches anything a missed webhook left behind), send the
 * "grace period ends soon" and "Pro has ended" notices once each, and pause the scheduled campaigns of organizations
 * whose Pro ended. Domain clean-up is in lib/pro/domains.ts.
 */
export async function runProDailyJobs(): Promise<{ recomputed: number; reminders: number; ended: number }> {
  const orgs = await query<Row & { id: number }>(`SELECT o.id FROM organizations o LEFT JOIN org_subscriptions s ON s.organization_id = o.id WHERE s.organization_id IS NOT NULL OR o.pro_comp_until IS NOT NULL OR o.pro_until IS NOT NULL`);
  for (const o of orgs) await recomputeProUntil(Number(o.id));

  const grace = await graceDays();
  let reminders = 0;
  const dueSoon = await query<Row & { organization_id: number; past_due_since: Date }>(
    `SELECT organization_id, past_due_since FROM org_subscriptions WHERE status = 'past_due' AND grace_reminder_sent_at IS NULL AND past_due_since IS NOT NULL
        AND past_due_since <= NOW() - INTERVAL ? DAY`, [Math.max(0, grace - 2)],
  );
  for (const s of dueSoon) {
    const claim = await execute(`UPDATE org_subscriptions SET grace_reminder_sent_at = NOW() WHERE organization_id = ? AND grace_reminder_sent_at IS NULL`, [s.organization_id]);
    if (!claim.affectedRows) continue;
    await notifyOrgAdmins(Number(s.organization_id), 'pro_grace_ending', { grace_end: fmtDate(new Date(new Date(s.past_due_since).getTime() + grace * 86_400_000)) });
    reminders++;
  }

  let ended = 0;
  // Paid at least once (a period end is known), no longer Pro, not told yet.
  const lapsed = await query<Row & { organization_id: number }>(
    `SELECT s.organization_id FROM org_subscriptions s JOIN organizations o ON o.id = s.organization_id
      WHERE s.current_period_end IS NOT NULL AND s.ended_notice_sent_at IS NULL AND (o.pro_until IS NULL OR o.pro_until <= NOW())`,
  );
  for (const s of lapsed) {
    const claim = await execute(`UPDATE org_subscriptions SET ended_notice_sent_at = NOW() WHERE organization_id = ? AND ended_notice_sent_at IS NULL`, [s.organization_id]);
    if (!claim.affectedRows) continue;
    await onProEnded(Number(s.organization_id));
    await notifyOrgAdmins(Number(s.organization_id), 'pro_ended', {});
    ended++;
  }
  return { recomputed: orgs.length, reminders, ended };
}

/** Rule 4 (lib/pro/status.ts): what stops when Pro ends. Nothing is deleted. */
export async function onProEnded(orgId: number): Promise<void> {
  await execute(
    `UPDATE marketing_campaigns SET status = 'paused', paused_reason = 'Fattixx Pro ended' WHERE organization_id = ? AND status IN ('scheduled','sending')`, [orgId],
  );
}
