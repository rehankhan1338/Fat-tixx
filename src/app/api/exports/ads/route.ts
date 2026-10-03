import { query, type Row } from '@/lib/db';
import { csvResponse, toCsv } from '@/lib/csv';
import { financeExportScope, logExport } from '@/lib/exports';

/** Ad performance export (plan 14.8): impressions, clicks and CTR per campaign, placement, event and day. Super Admin only. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await financeExportScope(['super_admin']);
  if (session instanceof Response) return session;
  const id = Number(new URL(req.url).searchParams.get('id')) || null;
  const rows = await query<Row>(
    `SELECT DATE_FORMAT(s.day, '%Y-%m-%d') AS day, c.id AS campaign_id, c.name AS campaign, c.kind, c.advertiser_name, s.placement, COALESCE(e.title, '') AS event, s.creative_id, s.impressions, s.clicks
       FROM ad_stats s JOIN ad_campaigns c ON c.id = s.campaign_id LEFT JOIN events e ON e.id = s.event_id
      ${id ? 'WHERE s.campaign_id = ?' : ''} ORDER BY s.day DESC, c.name, s.placement LIMIT 100000`, id ? [id] : [],
  );
  await logExport(session.user.id, 'ads', { campaignId: id, rows: rows.length });
  return csvResponse(`ad-report${id ? `-campaign-${id}` : ''}.csv`, toCsv(
    ['day_utc', 'campaign_id', 'campaign', 'type', 'advertiser', 'placement', 'event', 'creative_id', 'impressions', 'clicks', 'ctr_pct'],
    rows.map((r) => [r.day, r.campaign_id, r.campaign, r.kind, r.advertiser_name, r.placement, r.event, r.creative_id, r.impressions, r.clicks, Number(r.impressions) ? ((Number(r.clicks) / Number(r.impressions)) * 100).toFixed(2) : '']),
  ));
}
