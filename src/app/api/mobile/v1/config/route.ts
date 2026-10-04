import { env } from '@/lib/env';
import { brandingForLayout } from '@/lib/branding';
import { getActiveStripe } from '@/lib/payments/stripe';
import { isSmsConfigured } from '@/lib/sms';
import { absoluteUrl } from '@/lib/mobile/events';
import { handle, json } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET → public platform settings the app needs at start-up. Only the Stripe *publishable* key is exposed. */
export const GET = handle(async () => {
  const [brand, stripe] = await Promise.all([brandingForLayout(), getActiveStripe()]);
  return json({
    name: brand.name, color: brand.color, logoUrl: absoluteUrl(brand.logoUrl), supportEmail: brand.supportEmail, appUrl: env.APP_URL,
    stripe: stripe ? { publishableKey: stripe.publishableKey, mode: stripe.mode } : null,
    smsEnabled: isSmsConfigured(),
    legal: { terms: `${env.APP_URL}/terms`, privacy: `${env.APP_URL}/privacy`, refunds: `${env.APP_URL}/refunds`, ticketing: `${env.APP_URL}/ticketing-terms` },
  });
});
