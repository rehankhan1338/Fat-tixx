import 'server-only';
import { execute, query, type Row } from './db';
import type { FeeConfig } from './money';
import { decryptSecret, encryptSecret } from './security/crypto';

export type SettingKey =
  | 'platform_fee_bps' | 'platform_fee_fixed_cents' | 'processing_fee_bps' | 'processing_fee_fixed_cents'
  | 'default_fee_mode' | 'default_currency' | 'hold_minutes' | 'platform_name' | 'support_email'
  | 'brand_color' | 'brand_logo_path' | 'stripe_mode';

export type Settings = Record<SettingKey, string>;

const DEFAULTS: Settings = {
  platform_fee_bps: '500', platform_fee_fixed_cents: '99', processing_fee_bps: '290', processing_fee_fixed_cents: '30',
  default_fee_mode: 'buyer_pays', default_currency: 'USD', hold_minutes: '10', platform_name: 'Fat Tixx', support_email: 'support@fattixx.com',
  brand_color: '#f59e0b', brand_logo_path: '', stripe_mode: 'test',
};

/** All settings rows (public + secret keys) keyed by name. */
async function allRows(): Promise<Record<string, string>> {
  const rows = await query<Row & { key: string; value: string }>('SELECT `key`, `value` FROM platform_settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSettings(): Promise<Settings> {
  const rows = await allRows();
  const out = { ...DEFAULTS };
  for (const k of Object.keys(out) as SettingKey[]) if (rows[k] !== undefined) out[k] = rows[k];
  return out;
}

/** One raw settings row (any key), or null when it has never been saved. Used for JSON documents such as the website content. */
export async function getSettingValue(key: string): Promise<string | null> {
  const rows = await query<Row & { value: string }>('SELECT `value` FROM platform_settings WHERE `key` = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string, userId: number | null): Promise<void> {
  await execute(
    'INSERT INTO platform_settings (`key`, `value`, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_by = VALUES(updated_by)',
    [key, value, userId],
  );
}

/** Fee configuration for an organization (org overrides → platform defaults). */
export async function feeConfigForOrg(org: { fee_bps_override: number | null; fee_fixed_cents_override: number | null }): Promise<FeeConfig> {
  const s = await getSettings();
  return {
    platformFeeBps: org.fee_bps_override ?? Number(s.platform_fee_bps),
    platformFeeFixedCents: org.fee_fixed_cents_override ?? Number(s.platform_fee_fixed_cents),
    processingFeeBps: Number(s.processing_fee_bps),
    processingFeeFixedCents: Number(s.processing_fee_fixed_cents),
  };
}

// ---------------------------------------------------------------------------
// Branding (used by the public site, panels and emails)
// ---------------------------------------------------------------------------
export interface Branding { name: string; color: string; logoPath: string | null; supportEmail: string }

export async function getBranding(): Promise<Branding> {
  const s = await getSettings();
  return { name: s.platform_name, color: /^#[0-9a-f]{6}$/i.test(s.brand_color) ? s.brand_color : '#f59e0b', logoPath: s.brand_logo_path || null, supportEmail: s.support_email };
}

// ---------------------------------------------------------------------------
// Stripe keys: two sets (test / live) stored encrypted; a mode switch picks the active one.
// Environment variables remain a fallback for the test set so existing .env.local setups keep working.
// ---------------------------------------------------------------------------
export type StripeMode = 'test' | 'live';
export interface StripeKeySet { secretKey: string | null; publishableKey: string | null; webhookSecret: string | null }
export interface StripeSettings { mode: StripeMode; test: StripeKeySet; live: StripeKeySet }

const SECRET_KEYS = ['stripe_test_secret', 'stripe_test_webhook', 'stripe_live_secret', 'stripe_live_webhook'] as const;

function readSecret(rows: Record<string, string>, key: string): string | null {
  const v = rows[key];
  if (!v) return null;
  try { return decryptSecret(v, `setting:${key}`); } catch { return null; }
}

export async function getStripeSettings(): Promise<StripeSettings> {
  const rows = await allRows();
  const mode: StripeMode = rows.stripe_mode === 'live' ? 'live' : 'test';
  const test: StripeKeySet = {
    secretKey: readSecret(rows, 'stripe_test_secret') ?? process.env.STRIPE_SECRET_KEY ?? null,
    publishableKey: rows.stripe_test_publishable || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
    webhookSecret: readSecret(rows, 'stripe_test_webhook') ?? process.env.STRIPE_WEBHOOK_SECRET ?? null,
  };
  const live: StripeKeySet = {
    secretKey: readSecret(rows, 'stripe_live_secret'),
    publishableKey: rows.stripe_live_publishable || null,
    webhookSecret: readSecret(rows, 'stripe_live_webhook'),
  };
  return { mode, test, live };
}

export async function saveStripeKeySet(mode: StripeMode, set: { secretKey?: string; publishableKey?: string; webhookSecret?: string }, userId: number): Promise<void> {
  if (set.secretKey !== undefined) await setSetting(`stripe_${mode}_secret`, set.secretKey ? encryptSecret(set.secretKey, `setting:stripe_${mode}_secret`) : '', userId);
  if (set.webhookSecret !== undefined) await setSetting(`stripe_${mode}_webhook`, set.webhookSecret ? encryptSecret(set.webhookSecret, `setting:stripe_${mode}_webhook`) : '', userId);
  if (set.publishableKey !== undefined) await setSetting(`stripe_${mode}_publishable`, set.publishableKey, userId);
}

export async function setStripeMode(mode: StripeMode, userId: number): Promise<void> {
  await setSetting('stripe_mode', mode, userId);
}

// ---------------------------------------------------------------------------
// Email delivery (Brevo): the API key is stored encrypted next to the Stripe keys so the public site and the admin
// console (separate deployments) share one configuration. BREVO_API_KEY / MAIL_FROM in the environment remain a
// fallback so existing .env.local setups keep working; a value saved here wins.
// ---------------------------------------------------------------------------
export const DEFAULT_MAIL_FROM = 'Fat Tixx <no-reply@fattixx.local>';

export interface EmailSettings {
  /** Brevo transactional API key, or null when email delivery is not configured. */
  apiKey: string | null;
  /** Sender, e.g. `Fat Tixx <tickets@fattixx.com>`; must be a sender verified in Brevo. */
  from: string;
  /** Where the key came from: saved in Admin → Settings, the BREVO_API_KEY environment variable, or nowhere. */
  source: 'settings' | 'env' | null;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const rows = await allRows();
  const saved = readSecret(rows, 'brevo_api_key');
  const apiKey = saved || process.env.BREVO_API_KEY?.trim() || null;
  const from = rows.mail_from?.trim() || process.env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;
  return { apiKey, from, source: saved ? 'settings' : apiKey ? 'env' : null };
}

export async function saveEmailSettings(set: { apiKey?: string; from?: string }, userId: number): Promise<void> {
  if (set.apiKey !== undefined) await setSetting('brevo_api_key', set.apiKey ? encryptSecret(set.apiKey, 'setting:brevo_api_key') : '', userId);
  if (set.from !== undefined) await setSetting('mail_from', set.from, userId);
}

/** Masked display of a Brevo key, e.g. "xkeysib-••••••••1a2b". */
export function maskBrevoKey(key: string | null): string | null {
  if (!key) return null;
  return `${key.startsWith('xkeysib-') ? 'xkeysib-' : key.slice(0, 3)}••••••••${key.slice(-4)}`;
}

/** Masked display, e.g. "sk_test_••••••••1a2b". */
export function maskKey(key: string | null): string | null {
  if (!key) return null;
  const prefix = key.slice(0, key.indexOf('_', 3) + 1 || 3);
  return `${prefix}••••••••${key.slice(-4)}`;
}

export { SECRET_KEYS };
