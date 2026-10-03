import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { execute, query, queryOne, type Row } from './db';

/**
 * Every outgoing email is written to `email_outbox` first (visible under Admin → Emails), then
 * delivered through SMTP when SMTP_URL is configured. Without SMTP the message is kept with
 * status "logged" so the whole flow can be exercised on localhost (XAMPP has no mail server).
 *
 * Failed sends are retried automatically by the background jobs with exponential backoff
 * (1, 2, 4, 8, 16 minutes … up to MAX_ATTEMPTS), so a provider hiccup during an on-sale does not lose tickets (plan 13.1).
 *
 *   SMTP_URL=smtp://user:pass@smtp.example.com:587   (or smtps://... for port 465)
 *   MAIL_FROM="Fat Tixx <tickets@fattixx.com>"
 */
export interface OutgoingEmail {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  html?: string;
  category?: 'transactional' | 'marketing';
  related?: { type: string; id: string | number };
}

export const MAX_ATTEMPTS = 8;

let transporter: Transporter | null | undefined;
function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const url = process.env.SMTP_URL;
  transporter = url ? nodemailer.createTransport(url) : null;
  return transporter;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM ?? 'Fat Tixx <no-reply@fattixx.local>';
}

async function markFailed(id: number, e: unknown): Promise<void> {
  // Next attempt after 2^attempts minutes (attempts counted after this failure).
  await execute(
    `UPDATE email_outbox SET status = 'failed', error = ?, attempts = attempts + 1,
            next_attempt_at = IF(attempts + 1 < ?, NOW() + INTERVAL POW(2, attempts) MINUTE, NULL) WHERE id = ?`,
    [String((e as Error).message).slice(0, 500), MAX_ATTEMPTS, id],
  );
}

async function deliver(id: number, msg: { to: string; toName: string | null; subject: string; text: string; html: string | null }): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: mailFrom(), to: msg.toName ? `"${msg.toName.replace(/"/g, '')}" <${msg.to}>` : msg.to, subject: msg.subject, text: msg.text, html: msg.html ?? undefined });
    await execute(`UPDATE email_outbox SET status = 'sent', sent_at = NOW(), error = NULL, next_attempt_at = NULL, attempts = attempts + 1 WHERE id = ?`, [id]);
    return true;
  } catch (e) {
    await markFailed(id, e);
    return false;
  }
}

export async function sendEmail(msg: OutgoingEmail): Promise<number> {
  const r = await execute(
    `INSERT INTO email_outbox (to_email, to_name, subject, text_body, html_body, category, related_type, related_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.to, msg.toName ?? null, msg.subject, msg.text, msg.html ?? null, msg.category ?? 'transactional',
     msg.related?.type ?? null, msg.related ? String(msg.related.id) : null],
  );
  const id = r.insertId;
  if (!getTransporter()) {
    await execute(`UPDATE email_outbox SET status = 'logged' WHERE id = ?`, [id]);
    return id;
  }
  await deliver(id, { to: msg.to, toName: msg.toName ?? null, subject: msg.subject, text: msg.text, html: msg.html ?? null });
  return id;
}

type OutboxRow = Row & { id: number; to_email: string; to_name: string | null; subject: string; text_body: string; html_body: string | null };

/** Retry one failed/queued message (Admin → Emails). */
export async function resendOutboxEmail(id: number): Promise<boolean> {
  const row = await queryOne<OutboxRow>(`SELECT id, to_email, to_name, subject, text_body, html_body FROM email_outbox WHERE id = ?`, [id]);
  if (!row) return false;
  return deliver(id, { to: row.to_email, toName: row.to_name, subject: row.subject, text: row.text_body, html: row.html_body });
}

/**
 * Background retry: failed messages whose backoff has elapsed, plus "queued" ones a crashed process never finished.
 * Each row is claimed with a conditional UPDATE first, so two app instances never send the same message twice.
 */
export async function retryDueEmails(limit = 50): Promise<{ retried: number; sent: number }> {
  if (!getTransporter()) return { retried: 0, sent: 0 };
  const due = await query<OutboxRow>(
    `SELECT id, to_email, to_name, subject, text_body, html_body FROM email_outbox
      WHERE (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= NOW() AND attempts < ?)
         OR (status = 'queued' AND created_at < NOW() - INTERVAL 5 MINUTE)
      ORDER BY id LIMIT ?`, [MAX_ATTEMPTS, limit],
  );
  let sent = 0;
  for (const row of due) {
    // Pushing next_attempt_at forward is the claim: only one updater can match the "due" condition.
    const claim = await execute(
      `UPDATE email_outbox SET next_attempt_at = NOW() + INTERVAL 10 MINUTE
        WHERE id = ? AND ((status = 'failed' AND next_attempt_at <= NOW())
           OR (status = 'queued' AND created_at < NOW() - INTERVAL 5 MINUTE AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())))`, [row.id],
    );
    if (!claim.affectedRows) continue;
    if (await deliver(Number(row.id), { to: row.to_email, toName: row.to_name, subject: row.subject, text: row.text_body, html: row.html_body })) sent++;
  }
  return { retried: due.length, sent };
}

export function isSmtpConfigured(): boolean {
  return !!process.env.SMTP_URL;
}

/** Minimal, safe HTML wrapper for transactional mail. */
export function htmlLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#18181b;color:#fbbf24;padding:18px 24px;font-size:20px;font-weight:bold">FAT TIXX</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;color:#71717a;font-size:12px">You received this email because of a purchase or account on Fat Tixx.</td></tr>
</table></td></tr></table></body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
