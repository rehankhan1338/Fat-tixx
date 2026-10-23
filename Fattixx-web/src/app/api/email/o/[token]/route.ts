import { recordOpen } from '@/lib/pro/email-marketing';

/** Open tracking for Fattixx Pro campaigns: a 1×1 image per recipient (lib/pro/email-marketing.ts). */
export const dynamic = 'force-dynamic';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(_req: Request, { params }: RouteContext<'/api/email/o/[token]'>) {
  try { await recordOpen((await params).token); } catch { /* tracking must never fail the image */ }
  return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
}
