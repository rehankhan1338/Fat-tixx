'use server';

import { sendEmail } from './email';
import { clientIp, userAgent } from './request';
import { humanCheck, rateLimited, BOT_MESSAGE, CAPTCHA_MESSAGE } from './security/bot';
import { DEFAULTS } from './site-content/schema';
import { isEmail } from './users';

/**
 * "Send me pricing" on /pricing. Fee figures are kept off the public pages, so each request is emailed to the team
 * inbox (site content `pricing.request.inbox`), who reply with the details. Reply-To is the requester.
 */
export type PricingRequestState = { ok?: boolean; error?: string; email?: string } | undefined;

export async function requestPricing(_prev: PricingRequestState, fd: FormData): Promise<PricingRequestState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 254);
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };

  const ip = await clientIp();
  const bot = await humanCheck(fd, ip);
  if (bot) return { error: bot === 'captcha' ? CAPTCHA_MESSAGE : BOT_MESSAGE };
  // Without TRUST_PROXY every visitor shares the IP "direct", so only the per-email limit applies then.
  if (ip !== 'direct' && rateLimited(`pricing:${ip}`, 5, 60 * 60_000)) return { error: 'Too many requests from this network. Please try again later.' };
  if (rateLimited(`pricing:${email}`, 3, 24 * 60 * 60_000)) return { error: 'We already have your request. We’ll be in touch soon.' };

  const ua = await userAgent();
  const subject = `New pricing request from ${email}`;
  const lines = [
    `${email} asked for Fattixx pricing on the pricing page.`,
    `Reply to this email to send them the details.`,
    '',
    `Received: ${new Date().toUTCString()}`,
    `IP: ${ip}`,
    ...(ua ? [`Browser: ${ua.slice(0, 300)}`] : []),
  ];
  await sendEmail({
    to: DEFAULTS.pricing.request.inbox,
    subject,
    text: lines.join('\n'),
    envelope: { replyTo: email },
    related: { type: 'pricing_request', id: email.slice(0, 64) },
  });
  return { ok: true, email };
}
