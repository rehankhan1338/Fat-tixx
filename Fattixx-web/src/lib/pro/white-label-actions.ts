'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, getOrgBySlug, type OrgContext } from '../authz';
import { assertSuperAdmin } from '../auth/guard';
import { MAX_SITE_PAGES, pageSlug, whiteLabelActive } from './white-label';

/**
 * White-label sites (lib/pro/white-label.ts).
 *  - Super Admin: switch the add-on on or off for an organization.
 *  - Organization Admin (while it is on): the email sender name and the site pages.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? '').trim().slice(0, max);
const RESERVED = new Set(['events', 'tickets', 'checkout', 'orders', 'admin', 'api', 'p']);

async function wlAdmin(fd: FormData): Promise<OrgContext> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  if (!whiteLabelActive(ctx.org)) {
    throw new Error('White-label is not on for this organization. Contact Fattixx to add it to your Pro plan.');
  }
  return ctx;
}

function refresh(slug: string) {
  revalidatePath(`/org/${slug}/pro/site`);
  revalidatePath(`/o/${slug}`, 'layout');
}

export async function setWhiteLabel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let session;
  try { session = await assertSuperAdmin(); } catch (e) { return { error: (e as Error).message }; }
  const org = await getOrgBySlug(str(fd, 'org', 64));
  if (!org) return { error: 'Organization not found.' };
  const on = str(fd, 'white_label', 3) === '1';
  await execute(`UPDATE organizations SET white_label = ? WHERE id = ?`, [on ? 1 : 0, org.id]);
  await audit('whitelabel.updated', { actorUserId: session.user.id, targetType: 'organization', targetId: org.id, metadata: { on } });
  revalidatePath(`/admin/organizations/${org.slug}`);
  refresh(org.slug);
  return { ok: true, message: on ? 'White-label is on. It works while the organization is on Fattixx Pro.' : 'White-label is off.' };
}

export async function saveSenderName(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await wlAdmin(fd); } catch (e) { return { error: (e as Error).message }; }
  const name = str(fd, 'email_sender_name', 80).replace(/["<>\r\n@]/g, '');
  await execute(`UPDATE organizations SET email_sender_name = ? WHERE id = ?`, [name || null, ctx.org.id]);
  await audit('whitelabel.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { senderName: name || null } });
  refresh(ctx.org.slug);
  return { ok: true, message: 'Saved.' };
}

export async function saveSitePage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await wlAdmin(fd); } catch (e) { return { error: (e as Error).message }; }
  const id = Number(fd.get('id')) || null;
  const title = str(fd, 'title', 120);
  const body = String(fd.get('body') ?? '').trim().slice(0, 20_000);
  if (title.length < 2) return { error: 'Give the page a title.' };
  if (!body) return { error: 'Write something on the page.' };
  const slug = pageSlug(str(fd, 'slug', 64) || title);
  if (RESERVED.has(slug)) return { error: 'Choose a different address for this page.' };
  const published = fd.get('published') ? 1 : 0;
  const clash = await queryOne<Row & { id: number }>(`SELECT id FROM org_site_pages WHERE organization_id = ? AND slug = ?`, [ctx.org.id, slug]);
  if (clash && Number(clash.id) !== id) return { error: `Another page already uses the address /p/${slug}.` };
  if (id) {
    const r = await execute(`UPDATE org_site_pages SET title = ?, slug = ?, body = ?, published = ?, sort_order = ? WHERE id = ? AND organization_id = ?`,
      [title, slug, body, published, Number(fd.get('sort_order')) || 0, id, ctx.org.id]);
    if (!r.affectedRows) return { error: 'Page not found.' };
  } else {
    const n = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM org_site_pages WHERE organization_id = ?`, [ctx.org.id]);
    if (Number(n?.n) >= MAX_SITE_PAGES) return { error: `You can have up to ${MAX_SITE_PAGES} pages.` };
    await execute(`INSERT INTO org_site_pages (organization_id, slug, title, body, published, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [ctx.org.id, slug, title, body, published, Number(fd.get('sort_order')) || 0]);
  }
  await audit('site_page.saved', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { slug } });
  refresh(ctx.org.slug);
  return { ok: true, message: id ? 'Page saved.' : 'Page added.' };
}

export async function deleteSitePage(fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await wlAdmin(fd); } catch (e) { return { error: (e as Error).message }; }
  const r = await execute(`DELETE FROM org_site_pages WHERE id = ? AND organization_id = ?`, [Number(fd.get('id')), ctx.org.id]);
  if (!r.affectedRows) return { error: 'Page not found.' };
  await audit('site_page.deleted', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  refresh(ctx.org.slug);
  return { ok: true, message: 'Page deleted.' };
}
