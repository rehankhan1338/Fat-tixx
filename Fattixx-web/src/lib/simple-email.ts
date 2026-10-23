import 'server-only';
import { query, type Row } from './db';
import { env } from './env';
import { escapeHtml, sendEmail } from './email';
import { brandedLayout } from './email-templates';
import { getBranding } from './settings';

/**
 * Short notices in the Fattixx email layout that do not need an editable template (advertiser and sponsorship
 * status changes, staff alerts). `lines` are plain text paragraphs; `link` becomes the button.
 */
export async function sendNotice(to: { email: string; name?: string | null }, subject: string, lines: string[], link?: { href: string; label: string }, related?: { type: string; id: number | string }): Promise<void> {
  const brand = await getBranding();
  const body = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('') + (link ? `<p><a href="${escapeHtml(link.href)}" class="btn">${escapeHtml(link.label)}</a></p>` : '');
  const text = `${subject}\n\n${lines.join('\n\n')}${link ? `\n\n${link.label}: ${link.href}` : ''}`;
  await sendEmail({ to: to.email, toName: to.name ?? null, subject, text, html: brandedLayout(subject, body, brand, env.APP_URL), related });
}

/** The same notice to every active Super Admin, or to the platform roles given. */
export async function noticeToStaff(subject: string, lines: string[], link?: { href: string; label: string }, roles: string[] = ['super_admin']): Promise<void> {
  const staff = await query<Row & { email: string; name: string }>(
    `SELECT DISTINCT u.email, u.name FROM users u JOIN user_platform_roles r ON r.user_id = u.id WHERE r.role IN (${roles.map(() => '?').join(',')}) AND u.status = 'active'`, roles,
  );
  for (const s of staff) await sendNotice({ email: s.email, name: s.name }, subject, lines, link);
}
