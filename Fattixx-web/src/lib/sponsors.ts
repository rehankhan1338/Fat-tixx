import 'server-only';
import { query, type Row } from './db';
import { uploadUrl } from './uploads';

export type SponsorRow = Row & {
  id: number; event_id: number; name: string; logo_path: string | null; url: string | null; tier: string | null;
  visible_from: Date | null; visible_until: Date | null; sort_order: number;
};

export async function listSponsors(eventId: number): Promise<SponsorRow[]> {
  return query<SponsorRow>(`SELECT * FROM event_sponsors WHERE event_id = ? ORDER BY sort_order, id`, [eventId]);
}

/** Sponsors to show on the public event page right now (inside their visibility window). */
export async function listVisibleSponsors(eventId: number) {
  const rows = await query<SponsorRow>(
    `SELECT * FROM event_sponsors WHERE event_id = ? AND (visible_from IS NULL OR visible_from <= NOW()) AND (visible_until IS NULL OR visible_until > NOW()) ORDER BY sort_order, id`, [eventId],
  );
  return rows.map((s) => ({ id: Number(s.id), name: s.name, logoUrl: uploadUrl(s.logo_path), url: s.url, tier: s.tier }));
}
