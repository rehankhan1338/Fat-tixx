import 'server-only';
import Stripe from 'stripe';
import { getStripeSettings, type StripeMode } from '../settings';

/**
 * Stripe client built from the keys stored in Admin → Payments (encrypted in the database).
 * The Super Admin switches between the **test** (sandbox) and **live** key sets with one toggle.
 * Phase 1: a single Fattixx account (Fattixx is seller of record); Connect comes in Phase 2/3.
 */
export interface ActiveStripe { mode: StripeMode; secretKey: string; publishableKey: string; webhookSecret: string | null }

export async function getActiveStripe(): Promise<ActiveStripe | null> {
  const s = await getStripeSettings();
  const set = s[s.mode];
  if (!set.secretKey || !set.publishableKey) return null;
  return { mode: s.mode, secretKey: set.secretKey, publishableKey: set.publishableKey, webhookSecret: set.webhookSecret };
}

export async function isStripeConfigured(): Promise<boolean> {
  return (await getActiveStripe()) !== null;
}

const clients = new Map<string, Stripe>();
export function stripeClient(secretKey: string): Stripe {
  let c = clients.get(secretKey);
  if (!c) { c = new Stripe(secretKey, { appInfo: { name: 'Fattixx', version: '0.1.0' } }); clients.set(secretKey, c); }
  return c;
}

/** Client for the active mode; throws when Stripe is not configured. */
export async function getStripe(): Promise<{ stripe: Stripe; active: ActiveStripe }> {
  const active = await getActiveStripe();
  if (!active) throw new Error('Stripe is not configured. Add your keys under Admin → Payments.');
  return { stripe: stripeClient(active.secretKey), active };
}

/** Events the webhook route (src/app/api/stripe/webhook) handles; the registered endpoint must deliver all of them. */
export const WEBHOOK_EVENTS = ['payment_intent.succeeded', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'] as const;

export interface WebhookEndpointStatus {
  /** The URL Stripe must call: `${APP_URL}/api/stripe/webhook` on the public site. */
  url: string;
  /** The matching endpoint registered in Stripe for the active mode, or null when there is none. */
  endpoint: { id: string; status: string; missingEvents: string[] } | null;
  /** True when the signing secret for the active mode is saved in Admin → Payments. */
  secretSaved: boolean;
  /** Everything in place: endpoint registered and enabled, all events subscribed, secret saved. */
  ok: boolean;
  /** Set when Stripe could not be queried; `ok` is then false. */
  error?: string;
}

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

/** Look the webhook endpoint up in Stripe instead of guessing from received events, so Monitoring shows the real state. */
export async function checkWebhookEndpoint(active: ActiveStripe, url: string): Promise<WebhookEndpointStatus> {
  const secretSaved = !!active.webhookSecret;
  try {
    const stripe = stripeClient(active.secretKey);
    const want = normalizeUrl(url);
    let found: Stripe.WebhookEndpoint | undefined;
    for await (const ep of stripe.webhookEndpoints.list({ limit: 100 }, { timeout: 10_000 })) {
      if (normalizeUrl(ep.url) === want) { found = ep; break; }
    }
    if (!found) return { url, endpoint: null, secretSaved, ok: false };
    const events = found.enabled_events;
    const missingEvents = events.includes('*') ? [] : WEBHOOK_EVENTS.filter((e) => !events.includes(e));
    const endpoint = { id: found.id, status: found.status, missingEvents };
    return { url, endpoint, secretSaved, ok: found.status === 'enabled' && missingEvents.length === 0 && secretSaved };
  } catch (e) {
    return { url, endpoint: null, secretSaved, ok: false, error: (e as Error).message };
  }
}

/**
 * Register (or repair) the webhook endpoint in Stripe for the active mode and return its signing secret.
 * Stripe only reveals the secret when an endpoint is created, so an existing endpoint whose secret is not saved
 * here is replaced; an existing endpoint with a saved secret only gets its event list completed.
 */
export async function registerWebhookEndpoint(active: ActiveStripe, url: string): Promise<{ id: string; secret: string | null; created: boolean }> {
  const stripe = stripeClient(active.secretKey);
  const current = await checkWebhookEndpoint(active, url);
  if (current.error) throw new Error(current.error);
  const events = [...WEBHOOK_EVENTS];
  if (current.endpoint && current.secretSaved) {
    if (current.endpoint.missingEvents.length || current.endpoint.status !== 'enabled') {
      await stripe.webhookEndpoints.update(current.endpoint.id, { enabled_events: events, disabled: false });
    }
    return { id: current.endpoint.id, secret: null, created: false };
  }
  if (current.endpoint) await stripe.webhookEndpoints.del(current.endpoint.id);
  const ep = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: 'Fattixx (payments, refunds, disputes)' });
  return { id: ep.id, secret: ep.secret ?? null, created: true };
}

/** Verify a key set by calling Stripe. Returns the account name / id or an error message. */
export async function testStripeKeys(secretKey: string): Promise<{ ok: true; account: string; livemode: boolean } | { ok: false; error: string }> {
  try {
    const s = stripeClient(secretKey);
    // Reading the balance proves the key is valid and tells us whether it is a live or test key.
    const bal = await s.balance.retrieve();
    const available = bal.available.reduce((n, b) => n + b.amount, 0);
    const currency = bal.available[0]?.currency?.toUpperCase() ?? 'USD';
    return { ok: true, account: `Stripe account (available balance ${(available / 100).toFixed(2)} ${currency})`, livemode: bal.livemode };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
