import 'server-only';
import { query, queryOne, type Row } from '../db';
import { uploadUrl } from '../uploads';
import { utcToWallClock } from '../tz';
import type { AdTargeting } from './placements';

export type CampaignRow = Row & {
  id: number; name: string; kind: string; organization_id: number | null; event_id: number | null; advertiser_name: string | null; advertiser_contact: string | null;
  status: string; starts_at: Date | null; ends_at: Date | null; weight: number; priority: number; destination_url: string; targeting: string | null;
  created_at: Date; org_name: string | null; event_title: string | null; placements: string | null; creatives: number; impressions: number; clicks: number;
  /** Advertiser portal (migration 0014, lib/ads/advertisers.ts) */
  advertiser_id: number | null; impressions_cap: number | null; impressions_served: number; price_cents: number | null;
  payment_status: 'unpaid' | 'paid' | 'refunded' | null; review_status: 'none' | 'submitted' | 'approved' | 'rejected'; review_notes: string | null;
  advertiser_company: string | null;
};

const CAMPAIGN_SELECT = `
  SELECT c.*, g.name AS org_name, e.title AS event_title, (SELECT a.company_name FROM advertisers a WHERE a.id = c.advertiser_id) AS advertiser_company,
         (SELECT GROUP_CONCAT(p.placement ORDER BY p.placement) FROM ad_campaign_placements p WHERE p.campaign_id = c.id) AS placements,
         (SELECT COUNT(*) FROM ad_creatives cr WHERE cr.campaign_id = c.id) AS creatives,
         (SELECT COALESCE(SUM(s.impressions),0) FROM ad_stats s WHERE s.campaign_id = c.id) AS impressions,
         (SELECT COALESCE(SUM(s.clicks),0) FROM ad_stats s WHERE s.campaign_id = c.id) AS clicks
    FROM ad_campaigns c LEFT JOIN organizations g ON g.id = c.organization_id LEFT JOIN events e ON e.id = c.event_id`;

export async function listCampaigns(filter: { organizationId?: number; eventId?: number } = {}): Promise<CampaignRow[]> {
  const where: string[] = []; const params: number[] = [];
  if (filter.organizationId) { where.push('c.organization_id = ?'); params.push(filter.organizationId); }
  if (filter.eventId) { where.push('c.event_id = ?'); params.push(filter.eventId); }
  return query<CampaignRow>(`${CAMPAIGN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.created_at DESC LIMIT 500`, params);
}

export async function getCampaign(id: number): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>(`${CAMPAIGN_SELECT} WHERE c.id = ?`, [id]);
}

export type CreativeRow = Row & { id: number; image_path: string | null; alt_text: string; headline: string | null; body: string | null; imageUrl?: string | null };

export async function listCreatives(campaignId: number): Promise<CreativeRow[]> {
  const rows = await query<CreativeRow>(`SELECT id, image_path, alt_text, headline, body FROM ad_creatives WHERE campaign_id = ? ORDER BY id`, [campaignId]);
  return rows.map((r) => ({ ...r, imageUrl: uploadUrl(r.image_path) }));
}

export type AdStatRow = Row & { label: string; impressions: number; clicks: number };

/** Performance by placement, by event and by day (plan 14.8). */
export async function campaignStats(campaignId: number): Promise<{ byPlacement: AdStatRow[]; byEvent: AdStatRow[]; byDay: AdStatRow[] }> {
  const [byPlacement, byEvent, byDay] = await Promise.all([
    query<AdStatRow>(`SELECT placement AS label, SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM ad_stats WHERE campaign_id = ? GROUP BY placement ORDER BY impressions DESC`, [campaignId]),
    query<AdStatRow>(
      `SELECT COALESCE(e.title, '(not on an event page)') AS label, SUM(s.impressions) AS impressions, SUM(s.clicks) AS clicks
         FROM ad_stats s LEFT JOIN events e ON e.id = s.event_id WHERE s.campaign_id = ? GROUP BY s.event_id, e.title ORDER BY impressions DESC LIMIT 50`, [campaignId]),
    query<AdStatRow>(`SELECT DATE_FORMAT(day, '%Y-%m-%d') AS label, SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM ad_stats WHERE campaign_id = ? GROUP BY day ORDER BY day DESC LIMIT 60`, [campaignId]),
  ]);
  return { byPlacement, byEvent, byDay };
}

/** Campaign row → form values (dates shown in Eastern time, the platform's home time zone). */
export function campaignFormValues(c: CampaignRow) {
  let t: AdTargeting = {};
  try { t = c.targeting ? (JSON.parse(c.targeting) as AdTargeting) : {}; } catch { t = {}; }
  const tri = (b: boolean | undefined) => (b === true ? 'yes' : b === false ? 'no' : 'any');
  const wall = (d: Date | null) => (d ? utcToWallClock(new Date(d), 'America/New_York') : '');
  return {
    id: Number(c.id), name: c.name, kind: c.kind, advertiser_name: c.advertiser_name ?? '', advertiser_contact: c.advertiser_contact ?? '', destination_url: c.destination_url,
    starts_at: wall(c.starts_at), ends_at: wall(c.ends_at), weight: Number(c.weight), priority: Number(c.priority), event_id: c.event_id ? String(c.event_id) : '',
    placements: (c.placements ?? '').split(',').filter(Boolean), t_regions: (t.regions ?? []).join(', '), t_cities: (t.cities ?? []).join(', '),
    t_age: tri(t.ageRestricted), t_signed: tri(t.signedIn), t_days: t.daysBeforeEvent ? String(t.daysBeforeEvent) : '',
    t_categories: t.categories ?? [], t_kinds: (t.ticketKinds ?? []) as string[], t_roles: (t.roles ?? []) as string[],
  };
}

export function ctr(impressions: number, clicks: number): string {
  return impressions ? `${((clicks / impressions) * 100).toFixed(2)}%` : '—';
}
