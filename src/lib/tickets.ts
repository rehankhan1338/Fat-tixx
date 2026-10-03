import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { env } from './env';

/**
 * Signed QR payloads. Format: FTX1.<ticketCode>.<secret>.<sig>
 *   sig = base64url(HMAC-SHA256(TICKET_SIGNING_KEY, "FTX1.<code>.<secret>"))[0..21]  (128 bits)
 *
 * A scanner can confirm authenticity offline from the signature alone; the server then checks
 * status (used / refunded / transferred) and enforces one-time use atomically.
 */
const PREFIX = 'FTX1';

function signingKey(): Buffer {
  const k = process.env.TICKET_SIGNING_KEY;
  if (!k || k.length < 32) throw new Error('TICKET_SIGNING_KEY missing or too short. Run `npm run db:setup` to generate it in .env.local.');
  return Buffer.from(k, 'utf8');
}

export function signTicket(code: string, secret: string): string {
  const body = `${PREFIX}.${code}.${secret}`;
  const sig = createHmac('sha256', signingKey()).update(body).digest('base64url').slice(0, 22);
  return `${body}.${sig}`;
}

/** Returns the ticket code if the payload is well-formed and the signature is valid, else null. */
export function verifyTicketPayload(payload: string): { code: string; secret: string } | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, code, secret, sig] = parts;
  if (!/^[A-Z0-9]{12}$/.test(code) || !/^[a-f0-9]{32}$/.test(secret) || sig.length !== 22) return null;
  const expected = createHmac('sha256', signingKey()).update(`${PREFIX}.${code}.${secret}`).digest('base64url').slice(0, 22);
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { code, secret };
}

/**
 * What an offline scanner stores per ticket: a hash of the full signed payload. The device can match a
 * scanned QR against it without holding anything that would let someone recreate a valid QR code.
 */
export function offlineTicketHash(code: string, secret: string): string {
  return createHash('sha256').update(signTicket(code, secret)).digest('hex').slice(0, 32);
}

export async function ticketQrDataUrl(code: string, secret: string): Promise<string> {
  return QRCode.toDataURL(signTicket(code, secret), { errorCorrectionLevel: 'M', margin: 1, width: 320 });
}

export async function ticketQrPngBuffer(code: string, secret: string): Promise<Buffer> {
  return QRCode.toBuffer(signTicket(code, secret), { errorCorrectionLevel: 'M', margin: 1, width: 480 });
}

export function ticketUrl(code: string, secret: string): string {
  return `${env.APP_URL}/t/${code}?k=${secret.slice(0, 12)}`;
}
