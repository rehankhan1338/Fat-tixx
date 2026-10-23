'use server';

import { revalidatePath } from 'next/cache';
import { execute } from '../db';
import { audit } from '../audit';
import { assertOrg, type OrgContext } from '../authz';
import { deleteUpload, saveImageUpload } from '../uploads';
import { checkBrandColors } from './brand-colors';
import { normalizeHostname } from './domain-names';
import { checkDomain, claimDomain, removeDomain } from './domains';
import { assertPro } from './gate';

/** Fattixx Pro: the organization's branding and custom domain. Organization Admins only. */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? '').trim().slice(0, max);

async function proAdmin(fd: FormData): Promise<OrgContext> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  assertPro(ctx);
  return ctx;
}

function refreshPublic(slug: string) {
  revalidatePath(`/org/${slug}/pro`, 'layout');
  revalidatePath(`/o/${slug}`);
  revalidatePath('/events/[slug]', 'page');
}

export async function saveBranding(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await proAdmin(fd); } catch (e) { return { error: (e as Error).message }; }
  let primary: string | null = null, accent: string | null = null;
  if (fd.get('use_colors')) {
    const c = checkBrandColors(str(fd, 'brand_primary', 9), str(fd, 'brand_accent', 9));
    if (!c.ok) return { error: c.error };
    primary = c.primary; accent = c.accent;
  }
  let cover = ctx.org.brand_cover_path;
  const file = fd.get('cover');
  if (file instanceof File && file.size > 0) {
    try { const p = await saveImageUpload(file, 'orgs', 2000); await deleteUpload(cover); cover = p; } catch (e) { return { error: (e as Error).message }; }
  } else if (fd.get('remove_cover') && cover) {
    await deleteUpload(cover);
    cover = null;
  }
  const ownHeader = fd.get('own_header') ? 1 : 0;
  await execute(`UPDATE organizations SET brand_primary = ?, brand_accent = ?, brand_cover_path = ?, brand_own_header = ? WHERE id = ?`, [primary, accent, cover, ownHeader, ctx.org.id]);
  await audit('pro.branding.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { primary, accent, cover: !!cover, ownHeader: !!ownHeader } });
  refreshPublic(ctx.org.slug);
  return { ok: true, message: 'Branding saved. It shows on all your event pages.' };
}

export async function addCustomDomain(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await proAdmin(fd); } catch (e) { return { error: (e as Error).message }; }
  const h = normalizeHostname(str(fd, 'hostname', 260));
  if (!h.ok) return { error: h.error };
  const r = await claimDomain(ctx.org.id, h.host, ctx.session.user.id);
  if (r.error) return { error: r.error };
  await audit('pro.domain.added', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { host: h.host } });
  revalidatePath(`/org/${ctx.org.slug}/pro/domain`);
  return { ok: true, message: `Added ${h.host}. Add the DNS records below, then check.` };
}

export async function checkCustomDomain(fd: FormData): Promise<ActionState> {
  let ctx: OrgContext;
  try { ctx = await proAdmin(fd); } catch (e) { return { error: (e as Error).message }; }
  const before = ctx.org.id;
  const r = await checkDomain(before);
  if (!r) return { error: 'No domain to check.' };
  if (r.status === 'active') await audit('pro.domain.verified', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { ssl: r.ssl } });
  revalidatePath(`/org/${ctx.org.slug}/pro/domain`);
  return r.status === 'active' || r.txtOk ? { ok: true, message: r.message } : { error: r.message };
}

export async function removeCustomDomain(fd: FormData): Promise<ActionState> {
  // Removing is allowed after Pro ends too, so a lapsed organization can free the domain.
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const host = await removeDomain(ctx.org.id);
  if (host) await audit('pro.domain.removed', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { host } });
  revalidatePath(`/org/${ctx.org.slug}/pro/domain`);
  return { ok: true };
}
