import 'server-only';
import { createHash } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Argon2id parameters. Above the OWASP 2024 minimum (19 MiB / t=2) because this protects
 * the platform owner's account and logins are infrequent. ~150–300 ms on a modern CPU.
 * Keep in sync with scripts/create-super-admin.mjs.
 * `algorithm: 2` is Algorithm.Argon2id (the package exports it as a const enum, which
 * cannot be referenced under isolatedModules).
 */
const ARGON = { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password, ARGON);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than the current policy. */
export function needsRehash(hash: string): boolean {
  const m = hash.match(/^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (!m) return true;
  return Number(m[1]) < ARGON.memoryCost || Number(m[2]) < ARGON.timeCost;
}

/**
 * A real Argon2id hash of a random value, verified against for accounts that do not exist.
 * Makes "unknown email" and "wrong password" take the same time, defeating user enumeration
 * through response timing.
 */
let dummyHashPromise: Promise<string> | null = null;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHashPromise ??= argonHash('fattixx-dummy-' + Math.random().toString(36), ARGON);
  await verifyPassword(await dummyHashPromise, password);
  return false;
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function passwordPolicyErrors(password: string, email?: string): string[] {
  const errs: string[] = [];
  if (password.length < PASSWORD_MIN) errs.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) errs.push(`Use at most ${PASSWORD_MAX} characters.`);
  if (email) {
    const local = email.split('@')[0]?.toLowerCase();
    if (local && local.length >= 3 && password.toLowerCase().includes(local)) errs.push('Must not contain your email name.');
  }
  if (/(.)\1\1\1/.test(password)) errs.push('No character repeated four or more times in a row.');
  if (/^[a-z]+$/i.test(password)) errs.push('Use more than only letters.');
  return errs;
}

/**
 * Have I Been Pwned k-anonymity check: only the first 5 hex chars of the SHA-1 leave the server.
 * Returns the breach count, or null if the service could not be reached.
 */
export async function pwnedPasswordCount(password: string): Promise<number | null> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'FatTixx' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [suf, count] = line.trim().split(':');
      if (suf === suffix) return Number(count);
    }
    return 0;
  } catch {
    return null;
  }
}
