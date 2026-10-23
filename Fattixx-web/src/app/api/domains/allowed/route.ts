import { certificateAllowed } from '@/lib/pro/domains';

/**
 * GET /api/domains/allowed?domain=tickets.brand.com → 200 when the host is a Fattixx Pro custom domain whose owner has
 * proved control (TXT record), 404 otherwise. For self-hosted deployments with on-demand TLS, e.g. Caddy:
 *
 *   { on_demand_tls { ask https://fattixx.com/api/domains/allowed } }
 *
 * so certificates are only issued for verified domains. On Vercel, certificates are issued when the domain is added
 * to the project (lib/pro/domains.ts) and this endpoint is unused.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const domain = (new URL(req.url).searchParams.get('domain') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(domain)) return new Response(null, { status: 404 });
  return new Response(null, { status: (await certificateAllowed(domain)) ? 200 : 404 });
}
