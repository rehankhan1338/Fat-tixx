import 'server-only';
import { resolve4, resolveCname, resolveTxt } from 'node:dns/promises';
import { headers } from 'next/headers';
import { db, execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { getSettingValue } from '../settings';
import { randomToken } from '../security/crypto';
import { isProActive } from './status';
import { isPlatformHost, txtRecordName, txtRecordValue, TXT_VALUE_PREFIX } from './domain-names';

/**
 * Custom domains (Fattixx Pro, plan 5.7.2).
 *
 *  - DNS check: the organization proves control with a TXT record (`_fattixx.<host>`), and points the host at Fattixx
 *    with a CNAME (subdomains) or A record (apex domains).
 *  - Automatic SSL: on Vercel the host is added to the project through the Vercel API (VERCEL_API_TOKEN,
 *    VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID) and Vercel issues the certificate. Self-hosted setups use on-demand
 *    TLS (e.g. Caddy) asking GET /api/domains/allowed. Either way the certificate is confirmed by an HTTPS request.
 *  - Routing: src/proxy.ts marks requests to a non-Fattixx host with `x-fx-domain`; `/` shows the organization's page
 *    and `/events/<slug>` its events. Everything else goes to the normal Fattixx address.
 *  - Fallback: an inactive domain, a lapsed Pro plan or another organization's event sends visitors to the normal URL.
 *  - No hijacking: a host serves one organization at a time (unique `live_hostname`). Another organization can only take
 *    it over by publishing its own TXT record after the current one's record is gone.
 */
export type DomainRow = Row & {
  id: number; organization_id: number; hostname: string; verify_token: string; status: 'pending' | 'active' | 'failed';
  txt_ok: number; dns_ok: number; ssl_status: 'not_started' | 'pending' | 'issued' | 'failed'; last_error: string | null;
  checked_at: Date | null; verified_at: Date | null; failing_since: Date | null; created_at: Date;
};

/** DNS targets shown to the organizer. Vercel's defaults unless the deployment says otherwise. */
export function dnsTargets(): { cname: string; a: string } {
  return {
    cname: (process.env.CUSTOM_DOMAIN_CNAME || 'cname.vercel-dns.com').toLowerCase().replace(/\.$/, ''),
    a: process.env.CUSTOM_DOMAIN_A || '76.76.21.21',
  };
}

export async function getOrgDomain(orgId: number): Promise<DomainRow | null> {
  return queryOne<DomainRow>(`SELECT * FROM org_domains WHERE organization_id = ?`, [orgId]);
}

// ---------------------------------------------------------------------------
// Request side
// ---------------------------------------------------------------------------

/** The custom domain this request came in on (set by src/proxy.ts, which drops any value the client sends). */
export async function requestCustomDomain(): Promise<string | null> {
  const h = (await headers()).get('x-fx-domain');
  return h && /^[a-z0-9.-]{1,253}$/.test(h) ? h : null;
}

export type ActiveDomain = { organizationId: number; slug: string; host: string; pro: boolean };

/** The organization an active domain serves, and whether it is on Pro (a lapsed plan falls back to the normal URL). */
export async function resolveActiveDomain(host: string): Promise<ActiveDomain | null> {
  const r = await queryOne<Row & { organization_id: number; slug: string; pro_until: Date | null }>(
    `SELECT d.organization_id, o.slug, o.pro_until FROM org_domains d JOIN organizations o ON o.id = d.organization_id
      WHERE d.live_hostname = ? AND o.status = 'active'`, [host],
  );
  return r ? { organizationId: Number(r.organization_id), slug: r.slug, host, pro: isProActive(r.pro_until) } : null;
}

/** The address an organization's pages are shared under: its active custom domain while on Pro, else the platform. */
export async function publicOriginFor(orgId: number): Promise<string> {
  const r = await queryOne<Row & { live_hostname: string; pro_until: Date | null }>(
    `SELECT d.live_hostname, o.pro_until FROM org_domains d JOIN organizations o ON o.id = d.organization_id WHERE d.organization_id = ? AND d.live_hostname IS NOT NULL AND d.ssl_status = 'issued'`, [orgId],
  );
  return r && isProActive(r.pro_until) ? `https://${r.live_hostname}` : env.APP_URL;
}

/** May an on-demand TLS server (Caddy `ask`) request a certificate for this host? Verified claims only. */
export async function certificateAllowed(host: string): Promise<boolean> {
  if (isPlatformHost(host)) return false;
  const r = await queryOne(`SELECT 1 FROM org_domains WHERE hostname = ? AND txt_ok = 1 AND status <> 'failed'`, [host.toLowerCase()]);
  return !!r;
}

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------
type DnsResult = { txt: string[]; cname: string[]; a: string[]; error?: string };

async function lookup(host: string): Promise<DnsResult> {
  const swallow = <T,>(p: Promise<T>, empty: T) => p.catch((e: NodeJS.ErrnoException) => (['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ENOTIMP', 'EREFUSED'].includes(e.code ?? '') ? empty : Promise.reject(e)));
  try {
    const [txt, cname, a] = await Promise.all([
      swallow(resolveTxt(txtRecordName(host)), [] as string[][]),
      swallow(resolveCname(host), [] as string[]),
      swallow(resolve4(host), [] as string[]),
    ]);
    return { txt: txt.map((parts) => parts.join('')), cname: cname.map((c) => c.toLowerCase().replace(/\.$/, '')), a };
  } catch (e) {
    return { txt: [], cname: [], a: [], error: `DNS lookup failed: ${(e as Error).message}` };
  }
}

/** Does the host point at Fattixx? CNAME to the target, the target A record, or the same addresses as the platform host. */
async function pointsAtUs(dns: DnsResult): Promise<boolean> {
  const t = dnsTargets();
  if (dns.cname.includes(t.cname)) return true;
  if (dns.a.includes(t.a)) return true;
  const appHost = new URL(env.APP_URL).hostname;
  if (dns.a.length && !isIpLocal(appHost)) {
    const ours = await resolve4(appHost).catch(() => [] as string[]);
    if (ours.length && dns.a.every((ip) => ours.includes(ip))) return true;
  }
  return false;
}
const isIpLocal = (h: string) => h === 'localhost' || /^127\./.test(h);

/** Is the certificate in place? A plain HTTPS request: Node rejects an invalid or missing certificate. */
async function httpsWorks(host: string): Promise<boolean> {
  try {
    await fetch(`https://${host}/api/health`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hosting provider (Vercel) — optional
// ---------------------------------------------------------------------------
function vercel(): { token: string; project: string; team: string | null } | null {
  const token = process.env.VERCEL_API_TOKEN, project = process.env.VERCEL_PROJECT_ID;
  return token && project ? { token, project, team: process.env.VERCEL_TEAM_ID || null } : null;
}

async function vercelCall(method: 'POST' | 'DELETE' | 'GET', path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const v = vercel()!;
  const url = `https://api.vercel.com${path}${v.team ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(v.team)}` : ''}`;
  const res = await fetch(url, {
    method, headers: { authorization: `Bearer ${v.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

/** Add the host to the Vercel project so Vercel routes it here and issues its certificate. Already added = fine. */
async function addToHosting(host: string): Promise<string | null> {
  const v = vercel();
  if (!v) return null;
  try {
    const r = await vercelCall('POST', `/v10/projects/${encodeURIComponent(v.project)}/domains`, { name: host });
    const code = (r.json.error as { code?: string } | undefined)?.code;
    if (r.ok || code === 'domain_already_in_use_by_project' || r.status === 409 && code === 'domain_already_exists') return null;
    return `The hosting provider did not accept the domain: ${(r.json.error as { message?: string } | undefined)?.message ?? r.status}`;
  } catch (e) {
    return `Could not reach the hosting provider: ${(e as Error).message}`;
  }
}

async function removeFromHosting(host: string): Promise<void> {
  const v = vercel();
  if (!v) return;
  try { await vercelCall('DELETE', `/v9/projects/${encodeURIComponent(v.project)}/domains/${encodeURIComponent(host)}`); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Claim, check, remove
// ---------------------------------------------------------------------------
export async function claimDomain(orgId: number, host: string, userId: number): Promise<{ error?: string }> {
  const existing = await getOrgDomain(orgId);
  if (existing) return { error: `Remove ${existing.hostname} first: an organization has one custom domain.` };
  await execute(`INSERT INTO org_domains (organization_id, hostname, verify_token, created_by) VALUES (?, ?, ?, ?)`, [orgId, host, randomToken(24).slice(0, 32), userId]);
  return {};
}

export type DomainCheck = { status: DomainRow['status']; txtOk: boolean; dnsOk: boolean; ssl: DomainRow['ssl_status']; message: string };

/**
 * Check DNS for the organization's domain and move it forward: pending → active once the TXT record proves control and
 * the host points here; then make sure hosting has it and the certificate works. Safe to run any number of times.
 */
export async function checkDomain(orgId: number): Promise<DomainCheck | null> {
  const d = await getOrgDomain(orgId);
  if (!d) return null;
  const dns = await lookup(d.hostname);
  const txtOk = dns.txt.includes(txtRecordValue(d.verify_token));
  const dnsOk = await pointsAtUs(dns);
  let status = d.status;
  let message = '';
  let ssl = d.ssl_status;
  let error: string | null = dns.error ?? null;

  if (!txtOk) message = `Add the TXT record ${txtRecordName(d.hostname)} with the value shown below.`;
  else if (!dnsOk) message = `Ownership confirmed. Now point ${d.hostname} at Fattixx (the CNAME or A record below).`;

  if (txtOk && dnsOk && d.status !== 'active') {
    const takeover = await takeOver(d);
    if (takeover) { error = takeover; message = takeover; }
    else { status = 'active'; message = 'Domain verified.'; }
  }
  if (status === 'active' && (!txtOk || !dnsOk)) {
    // An active domain whose records disappeared keeps serving for 3 days (DNS hiccups), then is switched off.
    const since = d.failing_since ? new Date(d.failing_since) : new Date();
    if (Date.now() - since.getTime() > 3 * 86_400_000) { status = 'failed'; message = 'The DNS records were removed, so the domain was switched off. Add them again and check.'; }
    else message = 'The DNS records for this domain are missing. Restore them within 3 days or the domain stops working.';
  }
  if (status === 'active') {
    if (ssl === 'not_started' || ssl === 'failed') {
      const hostErr = await addToHosting(d.hostname);
      ssl = hostErr ? 'failed' : 'pending';
      if (hostErr) error = hostErr;
    }
    if (ssl === 'pending' && await httpsWorks(d.hostname)) ssl = 'issued';
    if (!message || message === 'Domain verified.') message = ssl === 'issued' ? `Live at https://${d.hostname}` : 'Verified. The secure certificate is being issued; this usually takes a few minutes.';
  }

  const failingSince = status === 'active' && (!txtOk || !dnsOk) ? d.failing_since ?? new Date() : null;
  await execute(
    `UPDATE org_domains SET status = ?, txt_ok = ?, dns_ok = ?, ssl_status = ?, last_error = ?, checked_at = NOW(), failing_since = ?,
            verified_at = IF(? = 'active' AND verified_at IS NULL, NOW(), verified_at) WHERE id = ?`,
    [status, txtOk ? 1 : 0, dnsOk ? 1 : 0, ssl, error ? error.slice(0, 500) : null, failingSince, status, d.id],
  );
  return { status, txtOk, dnsOk, ssl, message };
}

/**
 * Before activating: if another organization serves this host, it keeps it while its own TXT record still exists
 * (whoever controls DNS published only one of them on purpose). Otherwise its claim is switched off and ours goes live.
 * Returns an error message when the host stays with the other organization.
 */
async function takeOver(d: DomainRow): Promise<string | null> {
  const other = await queryOne<DomainRow>(`SELECT * FROM org_domains WHERE live_hostname = ? AND organization_id <> ?`, [d.hostname, d.organization_id]);
  if (!other) return null;
  const dns = await lookup(d.hostname);
  if (dns.txt.includes(txtRecordValue(other.verify_token))) return 'This domain is in use by another organizer on Fattixx. Contact support if it belongs to you.';
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE org_domains SET status = 'failed', last_error = 'Another organization proved control of this domain.' WHERE id = ?`, [other.id]);
    await conn.query(`UPDATE org_domains SET status = 'active' WHERE id = ?`, [d.id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    return `Could not activate the domain: ${(e as Error).message}`;
  } finally {
    conn.release();
  }
  return null;
}

export async function removeDomain(orgId: number): Promise<string | null> {
  const d = await getOrgDomain(orgId);
  if (!d) return null;
  await execute(`DELETE FROM org_domains WHERE id = ?`, [d.id]);
  // Only drop it from hosting if no other organization now serves it.
  const still = await queryOne(`SELECT 1 FROM org_domains WHERE hostname = ? AND status = 'active'`, [d.hostname]);
  if (!still) await removeFromHosting(d.hostname);
  return d.hostname;
}

/** Once a day: re-check active domains, and release the domains of organizations whose Pro ended long enough ago. */
export async function runDomainDailyJobs(): Promise<{ checked: number; released: number }> {
  const hold = Number(await getSettingValue('pro_domain_hold_days')) || 30;
  const lapsed = await query<Row & { organization_id: number }>(
    `SELECT d.organization_id FROM org_domains d JOIN organizations o ON o.id = d.organization_id
      WHERE (o.pro_until IS NULL AND d.created_at < NOW() - INTERVAL ? DAY) OR o.pro_until < NOW() - INTERVAL ? DAY`, [hold, hold],
  );
  for (const r of lapsed) await removeDomain(Number(r.organization_id));
  const live = await query<Row & { organization_id: number }>(`SELECT organization_id FROM org_domains WHERE status IN ('active','pending') AND txt_ok = 1`);
  for (const r of live) {
    try { await checkDomain(Number(r.organization_id)); } catch (e) { console.error('[domains] check failed', e); }
  }
  return { checked: live.length, released: lapsed.length };
}

/** For the instructions: the TXT value without the record name. */
export const verificationValue = (d: Pick<DomainRow, 'verify_token'>) => `${TXT_VALUE_PREFIX}${d.verify_token}`;
