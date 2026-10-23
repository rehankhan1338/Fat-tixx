'use server';

import { redirect } from 'next/navigation';
import { clientIp } from '../request';
import { rateLimited } from '../security/bot';
import { getPublicEventBySlug, publicEventPath } from './queries';
import { unlockEvent } from './password';

export type PasswordState = { error?: string } | undefined;

/** The password form on a protected event page. */
export async function submitEventPassword(_prev: PasswordState, fd: FormData): Promise<PasswordState> {
  const event = await getPublicEventBySlug(String(fd.get('event') ?? ''));
  if (!event) return { error: 'Event not found.' };
  const ip = await clientIp();
  if (rateLimited(`event-password:${event.id}:${ip}`, 20, 10 * 60_000)) return { error: 'Too many tries. Wait a few minutes and try again.' };
  if (!(await unlockEvent(event, String(fd.get('password') ?? '').slice(0, 100)))) return { error: 'That password is not right. Check with the organizer.' };
  // Private events keep their link key; anything else on the URL (codes, UTM) was carried in the form.
  const back = new URL(publicEventPath(event), 'http://x');
  const carry = String(fd.get('query') ?? '');
  for (const [k, v] of new URLSearchParams(carry)) if (k !== 'key') back.searchParams.set(k, v);
  redirect(`${back.pathname}${back.search}`);
}
