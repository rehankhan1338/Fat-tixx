import 'server-only';
import { execute, queryOne, type Row } from './db';
import { randomToken, sha256 } from './security/crypto';

export type TokenPurpose = 'set_password' | 'reset_password' | 'find_tickets' | 'verify_email';

const TTL_MINUTES: Record<TokenPurpose, number> = {
  set_password: 7 * 24 * 60,   // invitation links: 7 days
  reset_password: 60,
  find_tickets: 30,
  verify_email: 24 * 60,
};

/** Create a one-time token; returns the plaintext token to embed in a link (only the hash is stored). */
export async function createOneTimeToken(purpose: TokenPurpose, email: string, userId: number | null, createdBy: number | null): Promise<string> {
  // Only one live token per purpose+email keeps old links from lingering.
  await execute(`DELETE FROM one_time_tokens WHERE purpose = ? AND email = ? AND (used_at IS NOT NULL OR expires_at < NOW())`, [purpose, email]);
  const token = randomToken(32);
  await execute(
    `INSERT INTO one_time_tokens (id, purpose, user_id, email, expires_at, created_by)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ? MINUTE, ?)`,
    [sha256(token), purpose, userId, email.toLowerCase(), TTL_MINUTES[purpose], createdBy],
  );
  return token;
}

export interface TokenRecord { id: string; purpose: TokenPurpose; userId: number | null; email: string }

export async function peekOneTimeToken(token: string, purpose: TokenPurpose): Promise<TokenRecord | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const row = await queryOne<Row & { id: string; purpose: TokenPurpose; user_id: number | null; email: string }>(
    `SELECT id, purpose, user_id, email FROM one_time_tokens WHERE id = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW()`,
    [sha256(token), purpose],
  );
  return row ? { id: row.id, purpose: row.purpose, userId: row.user_id == null ? null : Number(row.user_id), email: row.email } : null;
}

/** Atomically mark a token used; returns false if it was already consumed. */
export async function consumeOneTimeToken(id: string): Promise<boolean> {
  const r = await execute(`UPDATE one_time_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL AND expires_at > NOW()`, [id]);
  return r.affectedRows === 1;
}
