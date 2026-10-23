import { env } from '@/lib/env';
import { recordClick } from '@/lib/pro/email-marketing';

/**
 * Click tracking for Fattixx Pro campaigns. Redirects only to a link stored for the recipient's campaign
 * (never to a URL taken from the request, so this is not an open redirect); anything else goes to the home page.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: RouteContext<'/api/email/c/[token]/[link]'>) {
  const { token, link } = await params;
  let to: string | null = null;
  try { to = await recordClick(token, Number(link)); } catch { /* fall through to the home page */ }
  return new Response(null, { status: 302, headers: { Location: to ?? env.APP_URL, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
