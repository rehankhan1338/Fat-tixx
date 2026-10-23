import 'server-only';
import { randomUUID } from 'node:crypto';
import { execute, queryOne, type Row } from './db';
import { env } from './env';
import { sendEmail } from './email';
import { renderEmail } from './email-templates';
import { createOneTimeToken } from './tokens';

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

export type UserRow = Row & {
  id: number; public_id: string; email: string; email_normalized: string; name: string; status: 'active' | 'suspended' | 'disabled';
  password_hash: string | null; email_verified_at: Date | null; last_login_at: Date | null; created_at: Date;
  first_name: string | null; last_name: string | null; phone_e164: string | null; google_sub: string | null; terms_accepted_at: Date | null;
};

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT * FROM users WHERE email_normalized = ?`, [normalizeEmail(email)]);
}

export async function findUserById(id: number): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]);
}

/** Create a user without a password (they set it through a one-time link). Returns existing user if present. */
export async function ensureUser(email: string, name: string): Promise<{ user: UserRow; created: boolean }> {
  const existing = await findUserByEmail(email);
  if (existing) return { user: existing, created: false };
  const r = await execute(
    `INSERT INTO users (public_id, email, email_normalized, name) VALUES (?, ?, ?, ?)`,
    [randomUUID(), email.trim(), normalizeEmail(email), name.trim() || email.split('@')[0]],
  );
  const user = await findUserById(r.insertId);
  return { user: user!, created: true };
}

/**
 * Send (and return) a "set your password" link. The link is also returned so an admin can hand
 * it over directly when no mail server is configured on localhost.
 */
export async function sendSetPasswordLink(user: UserRow, opts: { invitedBy: number | null; context: string; purpose?: 'set_password' | 'reset_password' }): Promise<string> {
  const purpose = opts.purpose ?? 'set_password';
  const token = await createOneTimeToken(purpose, user.email, user.id, opts.invitedBy);
  const url = `${env.APP_URL}/set-password/${token}`;
  const isReset = purpose === 'reset_password';
  const mail = await renderEmail(isReset ? 'password_reset' : 'invitation', { url, context: opts.context });
  await sendEmail({ to: user.email, toName: user.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'user', id: user.id } });
  return url;
}
