'use server';

/*
 * The sign-up window at the end of /create (src/components/create/SignUpDialog.tsx). Every export is a public POST
 * endpoint; the checks live in ./passwordless.ts.
 */

import { hostOrganizations, type HostOrganization } from '../home/create-context';
import { clientIp } from '../request';
import { verifyCaptcha } from '../security/captcha';
import { CAPTCHA_MESSAGE } from '../security/bot';
import { completeSignup, sendSignInCode, verifySignInCode, type Channel, type SendResult } from './passwordless';

const channelOf = (v: unknown): Channel | null => (v === 'email' || v === 'sms' ? v : null);

/** Sending a code is the sign-up step a bot would hammer, so it carries the CAPTCHA token (when the CAPTCHA is on). */
export async function requestSignInCode(channel: Channel, destination: string, captchaToken?: string | null): Promise<SendResult> {
  const c = channelOf(channel);
  if (!c || typeof destination !== 'string') return { ok: false, error: 'Choose email or text message.' };
  if (!(await verifyCaptcha(typeof captchaToken === 'string' ? captchaToken : null, await clientIp()))) return { ok: false, error: CAPTCHA_MESSAGE };
  return sendSignInCode(c, destination.slice(0, 254));
}

export type CodeCheckResult =
  | { ok: true; status: 'signed_in'; organizations: HostOrganization[] }
  | { ok: true; status: 'needs_profile'; email: string | null; phone: string | null }
  | { ok: false; error: string; expired?: boolean };

export async function checkSignInCode(channel: Channel, destination: string, code: string): Promise<CodeCheckResult> {
  const c = channelOf(channel);
  if (!c || typeof destination !== 'string' || typeof code !== 'string') return { ok: false, error: 'Start again with your email or number.', expired: true };
  const r = await verifySignInCode(c, destination.slice(0, 254), code.slice(0, 12));
  if (!r.ok) return r;
  if (r.status === 'signed_in') return { ok: true, status: 'signed_in', organizations: await hostOrganizations(r.userId) };
  return r;
}

export type SignupResult = { ok: true } | { ok: false; error: string; field?: string; restart?: boolean };

/** First and last name, email (when signing up by text) and the terms. Organizer name is saved with the event. */
export async function finishSignup(input: { firstName: string; lastName: string; email?: string; acceptTerms: boolean }): Promise<SignupResult> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Something went wrong. Please try again.' };
  const r = await completeSignup({
    firstName: String(input.firstName ?? '').slice(0, 100), lastName: String(input.lastName ?? '').slice(0, 100),
    email: typeof input.email === 'string' ? input.email.slice(0, 254) : undefined, acceptTerms: input.acceptTerms === true,
  });
  return r.ok ? { ok: true } : r;
}
