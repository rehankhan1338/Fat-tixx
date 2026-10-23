import { unsubscribeByToken } from '@/lib/pro/email-marketing';

/**
 * One-click unsubscribe (RFC 8058) for Fattixx Pro campaigns: mail apps POST `List-Unsubscribe=One-Click` to the URL in
 * the List-Unsubscribe header. A GET (someone opening the URL) shows the confirmation page instead, so link scanners
 * that prefetch URLs never unsubscribe anyone.
 */
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: RouteContext<'/api/email/unsubscribe/[token]'>) {
  const ok = await unsubscribeByToken((await params).token, 'one_click');
  return new Response(ok ? 'Unsubscribed' : 'Invalid link', { status: ok ? 200 : 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(req: Request, { params }: RouteContext<'/api/email/unsubscribe/[token]'>) {
  return Response.redirect(new URL(`/unsubscribe/${encodeURIComponent((await params).token)}`, req.url), 303);
}
