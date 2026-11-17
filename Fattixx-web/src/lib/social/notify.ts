import 'server-only';
import { after } from 'next/server';
import { execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { publicEventPath } from '../events/queries';
import { sendSms } from '../sms';
import { formatEventDate } from '../tz';

/**
 * Following organizers (11.5): followers get one email, and a text if they opted in, when the organizer publishes a new
 * public event. Claimed with events.followers_notified_at so every publish path (publish button, create flow,
 * verification release) can call it and each event is announced once. Private, unlisted and password-protected
 * events, and drafts, are never announced; muted follows are skipped.
 */
/** Call wherever an event goes live: the follower notices go out after the response, so publishing stays quick. */
export function eventWentLive(eventId: number): void {
  const run = () => notifyFollowersOfNewEvent(eventId).catch((e) => console.error('[social] follower notice failed', eventId, e));
  try { after(run); } catch { void run(); }
}

export async function notifyFollowersOfNewEvent(eventId: number): Promise<number> {
  const claim = await execute(
    `UPDATE events SET followers_notified_at = NOW()
      WHERE id = ? AND followers_notified_at IS NULL AND status = 'published' AND visibility = 'public' AND access_password IS NULL
        AND COALESCE(ends_at, starts_at) > NOW()`,
    [eventId],
  );
  if (!claim.affectedRows) return 0;
  const ev = await queryOne<Row & { id: number; slug: string; visibility: 'public'; private_key: string | null; title: string; starts_at: Date; timezone: string; organization_id: number; org_name: string; venue_name: string | null; venue_city: string | null; online_url: string | null }>(
    `SELECT e.id, e.slug, e.visibility, e.private_key, e.title, e.starts_at, e.timezone, e.organization_id, o.name AS org_name, v.name AS venue_name, v.city AS venue_city, e.online_url
       FROM events e JOIN organizations o ON o.id = e.organization_id LEFT JOIN venues v ON v.id = e.venue_id WHERE e.id = ?`, [eventId],
  );
  if (!ev) return 0;
  const followers = await query<Row & { id: number; email: string; name: string; phone: string | null; social_sms_opt_in: number }>(
    `SELECT u.id, u.email, u.name, u.phone, u.social_sms_opt_in FROM org_follows f JOIN users u ON u.id = f.user_id
      WHERE f.organization_id = ? AND f.muted = 0 AND u.status = 'active' AND u.email NOT LIKE '%@deleted.invalid'`,
    [ev.organization_id],
  );
  if (!followers.length) return 0;
  const url = `${env.APP_URL}${publicEventPath(ev)}`;
  const when = formatEventDate(new Date(ev.starts_at), ev.timezone);
  const venue = [ev.venue_name, ev.venue_city].filter(Boolean).join(', ') || (ev.online_url ? 'Online event' : '');
  const mail = await renderEmail('follower_new_event', {
    org_name: ev.org_name, event_title: ev.title, event_when: when, venue_line: venue, event_url: url, manage_url: `${env.APP_URL}/account/following`,
  });
  for (const f of followers) {
    await sendEmail({ to: f.email, toName: f.name, subject: mail.subject, text: mail.text, html: mail.html, category: 'marketing', related: { type: 'event', id: ev.id } });
    if (f.social_sms_opt_in && f.phone) await sendSms(f.phone, `${ev.org_name} just announced ${ev.title}, ${when}. ${url} (Reply STOP to opt out)`, { type: 'event', id: ev.id });
  }
  return followers.length;
}
