'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, type OrgContext } from '../authz';
import { parseDollarsToCents } from '../money';
import { assertPro } from './gate';
import { audienceSize, getCampaign, sendCampaignTest, syncContacts, unsubscribeByToken } from './email-marketing';
import { cleanRules, parseRules, type SegmentRules } from './segments';

/** Fattixx Pro email marketing (plan 5.7.2): campaigns, segments, templates and contacts. Organizers and Organization Admins. */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const base = (slug: string) => `/org/${slug}/email`;

async function proOrganizer(fd: FormData): Promise<OrgContext> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  assertPro(ctx);
  return ctx;
}

async function guarded<T>(fd: FormData, fn: (ctx: OrgContext) => Promise<T>): Promise<T | { error: string }> {
  let ctx: OrgContext;
  try { ctx = await proOrganizer(fd); } catch (e) { return { error: (e as Error).message }; }
  return fn(ctx);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
const EDITABLE = ['draft', 'scheduled', 'paused'];

/** Save a campaign as a draft, schedule it, or send it now (`intent`). */
export async function saveCampaign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guarded(fd, async (ctx) => {
    const id = Number(fd.get('campaign_id')) || null;
    const existing = id ? await getCampaign(ctx.org.id, id) : null;
    if (id && !existing) return { error: 'Campaign not found.' };
    if (existing && !EDITABLE.includes(existing.status)) return { error: 'This campaign has already been sent and can no longer be changed.' };
    const name = str(fd, 'name', 120), subject = str(fd, 'subject', 200), preheader = str(fd, 'preheader', 200), body = String(fd.get('body') ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 50_000);
    if (subject.length < 2) return { error: 'Write a subject line.' };
    if (body.length < 2) return { error: 'Write the email.' };
    const eventId = Number(fd.get('event_id')) || null;
    if (eventId && !(await queryOne(`SELECT 1 FROM events WHERE id = ? AND organization_id = ?`, [eventId, ctx.org.id]))) return { error: 'Choose one of your events.' };
    const segmentId = Number(fd.get('segment_id')) || null;
    const segment = segmentId ? await queryOne<Row & { rules: string | object }>(`SELECT rules FROM marketing_segments WHERE id = ? AND organization_id = ?`, [segmentId, ctx.org.id]) : null;
    if (segmentId && !segment) return { error: 'Choose one of your audiences.' };

    const intent = str(fd, 'intent', 10);
    let status: 'draft' | 'scheduled' = 'draft';
    let scheduledAt: Date | null = null;
    if (intent === 'schedule' || intent === 'send') {
      if (!ctx.org.mailing_address) return { error: 'Add your mailing address under Settings on this page first. The law requires it in marketing emails.' };
      await syncContacts(ctx.org.id);
      if (!(await audienceSize(ctx.org.id, segment ? parseRules(segment.rules) : null))) return { error: 'Nobody in this audience has subscribed yet.' };
      if (intent === 'schedule') {
        scheduledAt = new Date(str(fd, 'scheduled_iso', 40));
        if (Number.isNaN(scheduledAt.getTime())) return { error: 'Choose when to send it.' };
        if (scheduledAt.getTime() < Date.now() + 60_000) return { error: 'Choose a time in the future (or send it now).' };
        if (scheduledAt.getTime() > Date.now() + 366 * 86_400_000) return { error: 'Campaigns can be scheduled up to a year ahead.' };
      } else scheduledAt = new Date();
      status = 'scheduled';
    }
    const vals = [name || subject.slice(0, 120), subject, preheader || null, body, eventId, segmentId, status, scheduledAt];
    let campaignId = id;
    if (existing) {
      // a paused campaign that already started keeps its frozen audience; it resumes from the campaign page
      if (existing.status === 'paused' && existing.started_at && status !== 'draft') return { error: 'This campaign is paused part-way. Resume it instead.' };
      await execute(`UPDATE marketing_campaigns SET name = ?, subject = ?, preheader = ?, body = ?, event_id = ?, segment_id = ?, status = ?, scheduled_at = ?, paused_reason = NULL WHERE id = ?`, [...vals, existing.id]);
    } else {
      const ins = await execute(
        `INSERT INTO marketing_campaigns (name, subject, preheader, body, event_id, segment_id, status, scheduled_at, organization_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...vals, ctx.org.id, ctx.session.user.id],
      );
      campaignId = ins.insertId;
    }
    await audit(status === 'scheduled' ? 'marketing.campaign.scheduled' : 'marketing.campaign.saved', { actorUserId: ctx.session.user.id, targetType: 'campaign', targetId: campaignId!, metadata: { org: ctx.org.id, scheduledAt } });
    revalidatePath(base(ctx.org.slug));
    return { ok: true, id: campaignId!, slug: ctx.org.slug, message: intent === 'send' ? 'Sending starts within a minute.' : status === 'scheduled' ? 'Scheduled.' : 'Draft saved.' };
  });
  if ('error' in r && r.error) return { error: r.error };
  const ok = r as { id: number; slug: string; message: string };
  redirect(`${base(ok.slug)}/${ok.id}?saved=${encodeURIComponent(ok.message)}`);
}

export async function sendTestCampaign(fd: FormData): Promise<ActionState> {
  return guarded(fd, async (ctx) => {
    const c = await getCampaign(ctx.org.id, Number(fd.get('campaign_id')));
    if (!c) return { error: 'Campaign not found.' };
    await sendCampaignTest(ctx.org.id, c, { email: ctx.session.user.email, name: ctx.session.user.name });
    await audit('marketing.test_sent', { actorUserId: ctx.session.user.id, targetType: 'campaign', targetId: c.id });
    return { ok: true, message: `Test sent to ${ctx.session.user.email}.` };
  });
}

/** Scheduled → back to draft; sending or paused → stopped (whoever has not received it yet never will). */
export async function cancelCampaign(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const c = await getCampaign(ctx.org.id, Number(fd.get('campaign_id')));
  if (!c) return { error: 'Campaign not found.' };
  if (c.status === 'scheduled') {
    await execute(`UPDATE marketing_campaigns SET status = 'draft', scheduled_at = NULL WHERE id = ? AND status = 'scheduled'`, [c.id]);
  } else if (c.status === 'sending' || c.status === 'paused') {
    await execute(`UPDATE marketing_campaigns SET status = 'canceled', finished_at = NOW() WHERE id = ?`, [c.id]);
    await execute(`UPDATE marketing_sends SET status = 'skipped' WHERE campaign_id = ? AND status = 'queued'`, [c.id]);
  } else return { error: 'Only scheduled or sending campaigns can be stopped.' };
  await audit('marketing.campaign.canceled', { actorUserId: ctx.session.user.id, targetType: 'campaign', targetId: c.id, metadata: { from: c.status } });
  revalidatePath(base(ctx.org.slug), 'layout');
  return { ok: true };
}

export async function resumeCampaign(fd: FormData): Promise<ActionState> {
  return guarded(fd, async (ctx) => {
    const c = await getCampaign(ctx.org.id, Number(fd.get('campaign_id')));
    if (!c || c.status !== 'paused') return { error: 'Only a paused campaign can be resumed.' };
    if (!ctx.org.mailing_address) return { error: 'Add your mailing address first.' };
    await execute(`UPDATE marketing_campaigns SET status = ?, scheduled_at = COALESCE(scheduled_at, NOW()), paused_reason = NULL WHERE id = ?`, [c.started_at ? 'sending' : 'scheduled', c.id]);
    await audit('marketing.campaign.scheduled', { actorUserId: ctx.session.user.id, targetType: 'campaign', targetId: c.id, metadata: { resumed: true } });
    revalidatePath(base(ctx.org.slug), 'layout');
    return { ok: true, message: 'Resumed.' };
  });
}

export async function deleteCampaign(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const c = await getCampaign(ctx.org.id, Number(fd.get('campaign_id')));
  if (!c) return { error: 'Campaign not found.' };
  if (c.status !== 'draft') return { error: 'Only drafts can be deleted. Sent campaigns are kept for their stats.' };
  await execute(`DELETE FROM marketing_campaigns WHERE id = ? AND status = 'draft'`, [c.id]);
  await audit('marketing.campaign.deleted', { actorUserId: ctx.session.user.id, targetType: 'campaign', targetId: c.id });
  revalidatePath(base(ctx.org.slug));
  redirect(base(ctx.org.slug));
}

export async function duplicateCampaign(fd: FormData): Promise<ActionState> {
  const r = await guarded(fd, async (ctx) => {
    const c = await getCampaign(ctx.org.id, Number(fd.get('campaign_id')));
    if (!c) return { error: 'Campaign not found.' };
    const ins = await execute(
      `INSERT INTO marketing_campaigns (organization_id, name, subject, preheader, body, event_id, segment_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [ctx.org.id, `${c.name} (copy)`.slice(0, 120), c.subject, c.preheader, c.body, c.event_id, c.segment_id, ctx.session.user.id],
    );
    return { id: ins.insertId, slug: ctx.org.slug };
  });
  if ('error' in r) return { error: r.error };
  redirect(`${base(r.slug)}/${r.id}`);
}

// ---------------------------------------------------------------------------
// Audiences (segments)
// ---------------------------------------------------------------------------
function rulesFromForm(fd: FormData): SegmentRules | { error: string } {
  const ids = (k: string) => fd.getAll(k).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const num = (k: string) => { const v = str(fd, k, 12); return v ? Number(v) : undefined; };
  const spent = str(fd, 'min_spent', 12);
  const minSpentCents = spent ? parseDollarsToCents(spent) : undefined;
  if (spent && !minSpentCents) return { error: 'Enter the minimum spend in dollars, e.g. 100.' };
  return cleanRules({
    eventIds: ids('event_ids'), excludeEventIds: ids('exclude_event_ids'), minOrders: num('min_orders'),
    boughtWithinDays: num('bought_within_days'), notBoughtWithinDays: num('not_bought_within_days'), minSpentCents,
    cities: str(fd, 'cities', 1000).split(',').map((s) => s.trim()).filter(Boolean),
  });
}

export async function saveSegment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(fd, async (ctx) => {
    const name = str(fd, 'name', 120);
    if (name.length < 2) return { error: 'Name the audience.' };
    const rules = rulesFromForm(fd);
    if ('error' in rules) return { error: rules.error as string };
    const ownIds = [...(rules.eventIds ?? []), ...(rules.excludeEventIds ?? [])];
    if (ownIds.length) {
      const n = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE organization_id = ? AND id IN (${ownIds.map(() => '?').join(',')})`, [ctx.org.id, ...ownIds]);
      if (Number(n?.n) !== new Set(ownIds).size) return { error: 'Choose events from your organization.' };
    }
    const id = Number(fd.get('segment_id')) || null;
    if (id) {
      const u = await execute(`UPDATE marketing_segments SET name = ?, rules = ? WHERE id = ? AND organization_id = ?`, [name, JSON.stringify(rules), id, ctx.org.id]);
      if (!u.affectedRows) return { error: 'Audience not found.' };
    } else {
      await execute(`INSERT INTO marketing_segments (organization_id, name, rules, created_by) VALUES (?, ?, ?, ?)`, [ctx.org.id, name, JSON.stringify(rules), ctx.session.user.id]);
    }
    await audit('marketing.segment.saved', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { name, rules } });
    await syncContacts(ctx.org.id);
    const size = await audienceSize(ctx.org.id, rules);
    revalidatePath(`${base(ctx.org.slug)}/audience`);
    return { ok: true, message: `Saved. ${size.toLocaleString()} subscribed ${size === 1 ? 'contact matches' : 'contacts match'} right now.` };
  });
}

export async function deleteSegment(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const id = Number(fd.get('segment_id'));
  const used = await queryOne(`SELECT 1 FROM marketing_campaigns WHERE segment_id = ? AND status IN ('scheduled','sending','paused')`, [id]);
  if (used) return { error: 'A scheduled or sending campaign uses this audience. Stop or change it first.' };
  await execute(`DELETE FROM marketing_segments WHERE id = ? AND organization_id = ?`, [id, ctx.org.id]);
  await audit('marketing.segment.deleted', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { segment: id } });
  revalidatePath(`${base(ctx.org.slug)}/audience`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export async function saveTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(fd, async (ctx) => {
    const name = str(fd, 'name', 120), subject = str(fd, 'subject', 200), body = String(fd.get('body') ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 50_000);
    if (name.length < 2 || subject.length < 2 || body.length < 2) return { error: 'A template needs a name, a subject and a body.' };
    const id = Number(fd.get('template_id')) || null;
    if (id) {
      const u = await execute(`UPDATE marketing_templates SET name = ?, subject = ?, body = ? WHERE id = ? AND organization_id = ?`, [name, subject, body, id, ctx.org.id]);
      if (!u.affectedRows) return { error: 'Template not found.' };
    } else {
      await execute(`INSERT INTO marketing_templates (organization_id, name, subject, body, created_by) VALUES (?, ?, ?, ?, ?)`, [ctx.org.id, name, subject, body, ctx.session.user.id]);
    }
    await audit('marketing.template.saved', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { name } });
    revalidatePath(`${base(ctx.org.slug)}/templates`);
    return { ok: true, message: 'Template saved.' };
  });
}

export async function deleteTemplate(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  await execute(`DELETE FROM marketing_templates WHERE id = ? AND organization_id = ?`, [Number(fd.get('template_id')), ctx.org.id]);
  await audit('marketing.template.deleted', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  revalidatePath(`${base(ctx.org.slug)}/templates`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings and contacts
// ---------------------------------------------------------------------------
export async function saveMailingAddress(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const address = str(fd, 'mailing_address', 300).replace(/\s*\n\s*/g, ', ');
  if (address.length < 8) return { error: 'Enter a full postal address (street or PO box, city, postal code).' };
  await execute(`UPDATE organizations SET mailing_address = ? WHERE id = ?`, [address, ctx.org.id]);
  await audit('org.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { mailing_address: true } });
  revalidatePath(base(ctx.org.slug), 'layout');
  return { ok: true, message: 'Saved.' };
}

/** The organizer removes someone (e.g. they asked by email). Permanent until that person opts in again at checkout. */
export async function unsubscribeContact(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const id = Number(fd.get('contact_id'));
  const u = await execute(`UPDATE marketing_contacts SET unsubscribed_at = NOW(), unsubscribe_source = 'organizer' WHERE id = ? AND organization_id = ? AND unsubscribed_at IS NULL`, [id, ctx.org.id]);
  if (u.affectedRows) await audit('marketing.contact.unsubscribed', { actorUserId: ctx.session.user.id, targetType: 'marketing_contact', targetId: id, metadata: { org: ctx.org.id } });
  revalidatePath(`${base(ctx.org.slug)}/audience`);
  return { ok: true };
}

/** The public unsubscribe page's button (no sign-in: the token in the link is the proof). */
export async function confirmUnsubscribe(_prev: { done?: boolean; error?: string } | undefined, fd: FormData): Promise<{ done?: boolean; error?: string }> {
  const ok = await unsubscribeByToken(str(fd, 'token', 80), 'link');
  return ok ? { done: true } : { error: 'This unsubscribe link is not valid.' };
}
