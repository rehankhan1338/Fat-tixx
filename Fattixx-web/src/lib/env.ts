import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Run \`npm run db:setup\` to generate .env.local.`);
  return v;
}

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?\/?$/i;

let warnedAdminAppUrl = false;

/**
 * Public origin used for every absolute link the app generates (emails, SMS, embed snippets, share links).
 * Resolution order: explicit APP_URL (ignored if it still points at localhost while running on Vercel),
 * then Vercel's production domain, then the current Vercel deployment URL, then localhost for `next dev`.
 *
 * The admin console (Fattixx-admin/) is deployed as its own Vercel project, so the Vercel fallbacks there name the
 * console, not the public site: every email it sends (refunds, re-sent tickets, approvals) would then carry links and a
 * logo URL on the console's domain, which serves no /images and no public pages. APP_URL must be set on that project.
 */
function resolveAppUrl(): string {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, '');
  const onVercel = !!process.env.VERCEL;
  if (explicit && !(onVercel && LOCALHOST_RE.test(explicit))) return explicit;
  if (onVercel && process.env.FX_APP === 'admin' && !warnedAdminAppUrl) {
    warnedAdminAppUrl = true;
    console.warn('[env] APP_URL is not set on the admin console deployment; links and the logo in emails sent from the console will point at the console itself. Set APP_URL to the public site, e.g. https://fat-tixx.vercel.app.');
  }
  if (onVercel) {
    // VERCEL_PROJECT_PRODUCTION_URL is the production/custom domain; VERCEL_URL is the unique deployment URL.
    // Both are bare hosts without a protocol.
    const host = process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
      : process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (host) return `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  return 'http://localhost:3000';
}

export const env = {
  get DB_HOST() { return process.env.DB_HOST ?? '127.0.0.1'; },
  get DB_PORT() { return Number(process.env.DB_PORT ?? 3307); },
  get DB_NAME() { return process.env.DB_NAME ?? 'fattixx'; },
  get DB_USER() { return required('DB_USER'); },
  get DB_PASSWORD() { return required('DB_PASSWORD'); },
  /** 32-byte hex key used for AES-256-GCM encryption of secrets stored in the database (Stripe keys). */
  get APP_ENCRYPTION_KEY(): Buffer {
    const hex = required('APP_ENCRYPTION_KEY');
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
    return Buffer.from(hex, 'hex');
  },
  get APP_URL() { return resolveAppUrl(); },
  /**
   * Origin of the admin console (the separate app in Fattixx-admin/), where platform staff sign in.
   * Set ADMIN_URL in production; `npm run admin:dev` serves it on port 3100 locally.
   */
  get ADMIN_URL() { return (process.env.ADMIN_URL?.trim() || 'http://localhost:3100').replace(/\/+$/, ''); },
  /** True inside the admin console (Fattixx-admin/next.config.ts sets FX_APP=admin); false on the public site. */
  get IS_ADMIN_APP() { return process.env.FX_APP === 'admin'; },
  /** Only trust X-Forwarded-For when explicitly behind a reverse proxy you control. */
  get TRUST_PROXY() { return process.env.TRUST_PROXY === 'true'; },
  get IS_PROD() { return process.env.NODE_ENV === 'production'; },
};
