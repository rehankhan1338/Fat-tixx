'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { assertOrg, canAccessEvent } from '../authz';
import { getSession } from '../auth/session';
import { getEvent } from '../events/queries';
import { escapeHtml, sendEmail } from '../email';
import { brandedLayout } from '../email-templates';
import { getBranding } from '../settings';
import { sendSms } from '../sms';
import { syncContacts } from '../pro/email-marketing';
import { rateLimited } from '../security/bot';
import { audienceUnsubToken, messageRecipients, parseAudienceFilters, parseAudienceUnsubToken } from './audience';

export type OrgSocialState = { ok?: boolean; error?: string; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

const NETWORK_HOSTS: Record<string, RegExp> = {
  instagram: /^(www\.)?instagram\.com$/i, tiktok: /^(www\.)?tiktok\.com$/i, facebook: /^(www\.|m\.)?facebook\.com$/i, x: /^(www\.)?(x|twitter)\.com$/i, youtube: /^(www\.)?youtube\.com$/i,
};

/** Organizer page social links and the follower-count switch (Settings). */
export async function saveOrgSocial(_prev: OrgSocialState, fd: FormData): Promise<OrgSocialState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const links: Record<string, string> = {};
  for (const [net, host] of Object.entries(NETWORK_HOSTS)) {
    let v = str(fd, `social_${net}`, 255);
    if (!v) continue;
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    try {
      const u = new URL(v);
      if (!host.test(u.hostname) || u.pathname.length < 2) return { error: `That ${net === 'x' ? 'X' : net} link doesn’t look right.` };
      u.protocol = 'https:';
      links[net] = u.toString();
    } catch { return { error: `That ${net} link doesn’t look right.` }; }
  }
  await execute(`UPDATE organizations SET social_links = ?, hide_follower_count = ? WHERE id = ?`,
    [Object.keys(links).length ? JSON.stringify(links) : null, fd.get('hide_follower_count') === 'on' ? 1 : 0, ctx.org.id]);
  await audit('org.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { social: Object.keys(links) } });
  revalidatePath(`/o/${ctx.org.slug}`);
  revalidatePath(`/org/${ctx.org.slug}/settings`);
  return { ok: true, message: 'Saved.' };
}

/** Per-event social settings: Who's Going mode, the activity feed and how long it stays open. */
export async function saveEventSocial(_prev: OrgSocialState, fd: FormData): Promise<OrgSocialState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) return { error: 'Event not found.' };
  const mode = str(fd, 'guest_list_mode', 20);
  if (!['off', 'faces', 'faces_total'].includes(mode)) return { error: 'Choose how Who’s Going shows.' };
  const days = Math.round(Number(str(fd, 'feed_open_days', 4)));
  if (!Number.isFinite(days) || days < 0 || days > 90) return { error: 'The feed can stay open 0 to 90 days after the event.' };
  await execute(`UPDATE events SET guest_list_mode = ?, feed_enabled = ?, feed_attendee_photos = ?, feed_open_days = ? WHERE id = ?`,
    [mode, fd.get('feed_enabled') === 'on' ? 1 : 0, fd.get('feed_attendee_photos') === 'on' ? 1 : 0, days, event.id]);
  await audit('social.settings', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { mode, feed: fd.get('feed_enabled') === 'on', days } });
  revalidatePath(`/events/${event.slug}`);
  revalidatePath(`/org/${ctx.org.slug}/events/${event.id}`);
  return { ok: true, message: 'Saved.' };
}

/**
 * Message followers and past attendees (11.10): email, plus a text for people who opted in to texts. Followers who
 * muted the organizer and attendees who never opted in (or unsubscribed) are left out.
 */
export async function sendAudienceMessage(_prev: OrgSocialState, fd: FormData): Promise<OrgSocialState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const subject = str(fd, 'subject', 200), body = str(fd, 'body', 5000);
  if (subject.length < 3 || body.length < 10) return { error: 'Enter a subject and a message.' };
  if (rateLimited(`audience-msg:${ctx.org.id}`, 3, 24 * 60 * 60_000)) return { error: 'You can send up to 3 audience messages a day.' };
  const filters = parseAudienceFilters(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>);
  const withSms = fd.get('with_sms') === 'on';
  await syncContacts(ctx.org.id);
  const recipients = await messageRecipients(ctx.org.id, filters);
  if (!recipients.length) return { error: 'Nobody in this audience can receive messages yet.' };
  const brand = await getBranding();
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');
  let emails = 0, texts = 0;
  for (const r of recipients) {
    const manage = r.follower
      ? `<p class="muted">You get this because you follow ${escapeHtml(ctx.org.name)} on ${escapeHtml(brand.name)}. <a href="${env.APP_URL}/account/following">Mute or unfollow</a>.</p>`
      : `<p class="muted">You get this because you asked for updates from ${escapeHtml(ctx.org.name)} when you bought tickets. <a href="${env.APP_URL}/unsubscribe/org/${audienceUnsubToken(ctx.org.id, r.email)}">Unsubscribe</a>.</p>`;
    const html = brandedLayout(subject, `<p><strong>${escapeHtml(ctx.org.name)}</strong></p><p>${bodyHtml}</p>${manage}`, brand, env.APP_URL);
    await sendEmail({
      to: r.email, toName: r.name, subject: `${ctx.org.name}: ${subject}`, text: `${ctx.org.name}\n\n${body}`, html, category: 'marketing',
      envelope: { fromName: ctx.org.name.slice(0, 80), replyTo: ctx.org.contact_email }, related: { type: 'organization', id: ctx.org.id },
    });
    emails++;
    if (withSms && r.sms && r.phone) { await sendSms(r.phone, `${ctx.org.name}: ${subject}. ${body.slice(0, 300)} (Reply STOP to opt out)`, { type: 'organization', id: ctx.org.id }); texts++; }
  }
  await execute(`INSERT INTO audience_messages (organization_id, audience, filters, subject, body, with_sms, email_count, sms_count, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ctx.org.id, filters.kind, JSON.stringify(filters).slice(0, 500), subject, body, withSms ? 1 : 0, emails, texts, ctx.session.user.id]);
  await audit('audience.message.sent', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { emails, texts, kind: filters.kind } });
  revalidatePath(`/org/${ctx.org.slug}/audience`);
  return { ok: true, message: `Sent ${emails} email(s)${texts ? ` and ${texts} text(s)` : ''}.` };
}

export async function unsubscribeFromOrg(token: string): Promise<OrgSocialState> {
  const t = parseAudienceUnsubToken(token);
  if (!t) return { error: 'This link is not valid.' };
  await execute(`UPDATE marketing_contacts SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()), unsubscribe_source = COALESCE(unsubscribe_source, 'audience_link') WHERE organization_id = ? AND email = ?`, [t.orgId, t.email]);
  await execute(`UPDATE orders SET marketing_opt_in = 0 WHERE organization_id = ? AND buyer_email = ?`, [t.orgId, t.email]);
  return { ok: true };
}

export async function audienceUnsubInfo(token: string): Promise<{ orgName: string; email: string } | null> {
  const t = parseAudienceUnsubToken(token);
  if (!t) return null;
  const o = await queryOne<Row & { name: string }>(`SELECT name FROM organizations WHERE id = ?`, [t.orgId]);
  return o ? { orgName: o.name, email: t.email } : null;
}

/** "Share that you're going" (11.8): count the share for the organizer's reports. */
export async function recordShare(eventId: number, channel: string): Promise<void> {
  const ch = ['story', 'native', 'copy', 'x', 'facebook', 'whatsapp', 'sms', 'email'].includes(channel) ? channel : 'other';
  const session = await getSession();
  const key = `share:${session?.user.id ?? 'anon'}:${eventId}:${ch}`;
  if (rateLimited(key, 5, 60 * 60_000)) return;
  const ev = await queryOne(`SELECT 1 FROM events WHERE id = ? AND status IN ('published','postponed')`, [eventId]);
  if (!ev) return;
  await execute(`INSERT INTO event_shares (event_id, user_id, channel) VALUES (?, ?, ?)`, [eventId, session?.user.id ?? null, ch]);
}
