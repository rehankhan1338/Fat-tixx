/*
 * Custom domain names (Fattixx Pro, plan 5.7.2): validation and the host rules shared by the proxy (src/proxy.ts), the
 * domain checks (lib/pro/domains.ts) and the tests. No database or Node-only imports, so the proxy can use it.
 */

/** TXT record that proves an organization controls a host: `_fattixx.<host>` = `fattixx-verify=<token>`. */
export const TXT_PREFIX = '_fattixx';
export const TXT_VALUE_PREFIX = 'fattixx-verify=';

export const txtRecordName = (host: string) => `${TXT_PREFIX}.${host}`;
export const txtRecordValue = (token: string) => `${TXT_VALUE_PREFIX}${token}`;

const hostOf = (url: string | undefined | null): string | null => {
  if (!url) return null;
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return null; }
};

/** Hosts that are Fattixx itself (never a custom domain): the public site, the admin console, Vercel's own URLs and PLATFORM_HOSTS. */
export function platformHosts(env: Record<string, string | undefined> = process.env): string[] {
  const list = [env.APP_URL, env.ADMIN_URL, env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, ...(env.PLATFORM_HOSTS ?? '').split(',')]
    .map((h) => hostOf(h?.trim()))
    .filter((h): h is string => !!h);
  return [...new Set(list)];
}

/** The public site's origin for redirects out of a custom domain (same order as src/lib/env.ts, without the logging). */
export function platformOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.APP_URL?.trim().replace(/\/+$/, '');
  if (explicit && !/localhost|127\.0\.0\.1/.test(explicit)) return explicit;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return explicit || 'http://localhost:3000';
}

/** Paths a custom domain serves itself (its events, everything buying a ticket needs, white-label site pages /p/…); the rest goes to the platform. */
export function customDomainServes(pathname: string): boolean {
  return pathname === '/' || pathname === '/embed.js' || /^\/(events|checkout|orders|t|tickets|api|embed|r|unsubscribe|_next|images|fonts|p)(\/|$)/.test(pathname) || /\.[a-z0-9]{2,5}$/i.test(pathname);
}

const IP = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

/** Is this request host a Fattixx host (or a local / preview one)? Anything else is treated as a custom domain. */
export function isPlatformHost(host: string, env: Record<string, string | undefined> = process.env): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h || IP.test(h) || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.vercel.app')) return true;
  return platformHosts(env).includes(h);
}

/** The platform's own domain and its subdomains can never be claimed: www.fattixx.com → fattixx.com and *.fattixx.com. */
function reservedRoots(env: Record<string, string | undefined>): string[] {
  return platformHosts(env).filter((h) => !h.endsWith('.vercel.app') && h !== 'localhost').map((h) => h.replace(/^www\./, ''));
}

export type HostnameCheck = { ok: true; host: string } | { ok: false; error: string };

/** Normalize what an organizer typed ("https://Tickets.Brand.com/", an IDN…) to a bare lower-case ASCII host, or say why not. */
export function normalizeHostname(input: string, env: Record<string, string | undefined> = process.env): HostnameCheck {
  const raw = String(input ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!raw) return { ok: false, error: 'Enter a domain, e.g. tickets.yourbrand.com.' };
  if (/[:@\s]/.test(raw)) return { ok: false, error: 'Enter just the domain, without a port or path.' };
  let host: string;
  // URL turns an internationalized name into its ASCII (punycode) form
  try { host = new URL(`https://${raw}`).hostname.toLowerCase(); } catch { return { ok: false, error: 'That is not a valid domain name.' }; }
  if (IP.test(host)) return { ok: false, error: 'Use a domain name, not an IP address.' };
  if (host.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host)) return { ok: false, error: 'That is not a valid domain name.' };
  if (host.startsWith(`${TXT_PREFIX}.`)) return { ok: false, error: 'Enter the domain itself, not the verification record.' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.vercel.app') || host.endsWith('.vercel-dns.com')) {
    return { ok: false, error: 'That domain cannot be used.' };
  }
  for (const root of reservedRoots(env)) {
    if (host === root || host.endsWith(`.${root}`)) return { ok: false, error: 'Fattixx addresses cannot be used as a custom domain.' };
  }
  return { ok: true, host };
}

/** Apex domains (brand.com) need an A record; subdomains (tickets.brand.com) a CNAME. A rough guess for the instructions. */
export function looksLikeApex(host: string): boolean {
  const parts = host.split('.');
  const twoPartTld = /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.length === (twoPartTld ? 3 : 2);
}
