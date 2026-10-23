import 'server-only';
import type { OrgContext } from '@/lib/authz';
import { query, type Row } from '@/lib/db';
import { listVisibleEvents } from '@/lib/events/queries';
import { STARTER_TEMPLATES } from '@/lib/pro/campaign-render';
import { audienceSize, syncContacts } from '@/lib/pro/email-marketing';
import { parseRules } from '@/lib/pro/segments';

/** What the campaign editor offers: the organization's events, audiences with their current size, and templates. */
export async function campaignEditorData(ctx: OrgContext) {
  await syncContacts(ctx.org.id);
  const [events, segments, saved, everyone] = await Promise.all([
    listVisibleEvents(ctx, 'all'),
    query<Row & { id: number; name: string; rules: string | object }>(`SELECT id, name, rules FROM marketing_segments WHERE organization_id = ? ORDER BY name`, [ctx.org.id]),
    query<Row & { id: number; name: string; subject: string; body: string }>(`SELECT id, name, subject, body FROM marketing_templates WHERE organization_id = ? ORDER BY name`, [ctx.org.id]),
    audienceSize(ctx.org.id, null),
  ]);
  const sized = await Promise.all(segments.map(async (s) => ({ id: Number(s.id), name: s.name, size: await audienceSize(ctx.org.id, parseRules(s.rules)) })));
  return {
    events: events.map((e) => ({ id: Number(e.id), title: e.title })),
    segments: sized,
    everyone,
    templates: [...saved.map((t) => ({ key: `own-${t.id}`, name: t.name, subject: t.subject, body: t.body })), ...STARTER_TEMPLATES],
  };
}
