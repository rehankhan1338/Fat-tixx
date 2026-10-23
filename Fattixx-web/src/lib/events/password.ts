import 'server-only';
import { cookies } from 'next/headers';
import { env } from '../env';
import { decryptSecret, encryptSecret, hmacHex, safeEqual } from '../security/crypto';

/**
 * Event password (plan 5.6, optional): visitors must type it before they see the event page or can buy tickets.
 * Stored encrypted (not hashed) so the organizer can read it back on the edit page and share it again. A visitor
 * who typed it gets an HttpOnly cookie holding a keyed hash of the event and password; changing the password
 * therefore locks everyone out again.
 */
const AAD = 'event_password';
export const PASSWORD_MAX = 64;
const UNLOCK_DAYS = 30;

export function encryptEventPassword(password: string): string {
  return encryptSecret(password, AAD);
}

/** The organizer's password in plain text, or null when the event has none (or it can't be read). */
export function decryptEventPassword(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored, AAD);
  } catch {
    return null;
  }
}

const cookieName = (eventId: number) => `fx_ep_${eventId}`;
const unlockValue = (eventId: number, password: string) => hmacHex(`event-unlock:${eventId}:${password}`);

/** True when the event has no password, or this browser has typed the current one. */
export async function eventUnlocked(event: { id: number; access_password: string | null }): Promise<boolean> {
  const password = decryptEventPassword(event.access_password);
  if (!password) return true;
  const got = (await cookies()).get(cookieName(Number(event.id)))?.value ?? '';
  return got.length === 64 && safeEqual(got, unlockValue(Number(event.id), password));
}

/** Check a typed password; on success remember it in this browser. */
export async function unlockEvent(event: { id: number; access_password: string | null }, typed: string): Promise<boolean> {
  const password = decryptEventPassword(event.access_password);
  if (!password) return true;
  if (!safeEqual(typed.trim(), password)) return false;
  (await cookies()).set(cookieName(Number(event.id)), unlockValue(Number(event.id), password), {
    httpOnly: true, secure: env.IS_PROD, sameSite: 'lax', path: '/', maxAge: UNLOCK_DAYS * 86_400,
  });
  return true;
}
