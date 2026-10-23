import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

/** 256-bit opaque token, URL-safe. Used for session cookies and one-time links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest. Used to store tokens so a DB leak does not expose live sessions. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Keyed SHA-256 (hex) with the app's secret key. Used where a plain hash could be brute-forced offline: 6-digit
 * sign-in codes, and the cookie that remembers an unlocked password-protected event.
 */
export function hmacHex(input: string): string {
  return createHmac('sha256', env.APP_ENCRYPTION_KEY).update(input).digest('hex');
}

/** Constant-time string comparison that does not leak length via early exit. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const VERSION = 0x01;

/**
 * AES-256-GCM authenticated encryption for secrets at rest (Stripe keys in platform_settings).
 * Output is base64: [version(1)][iv(12)][tag(16)][ciphertext]. `aad` binds the blob to its purpose.
 */
export function encryptSecret(plaintext: string, aad: string): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', env.APP_ENCRYPTION_KEY, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(blobB64: string, aad: string): string {
  const blob = Buffer.from(blobB64, 'base64');
  if (blob.length < 1 + GCM_IV_BYTES + GCM_TAG_BYTES || blob[0] !== VERSION) throw new Error('Unsupported ciphertext format');
  const iv = blob.subarray(1, 1 + GCM_IV_BYTES);
  const tag = blob.subarray(1 + GCM_IV_BYTES, 1 + GCM_IV_BYTES + GCM_TAG_BYTES);
  const ct = blob.subarray(1 + GCM_IV_BYTES + GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', env.APP_ENCRYPTION_KEY, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
