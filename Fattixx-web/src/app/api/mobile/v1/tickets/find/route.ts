import { queryOne } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { renderEmail } from '@/lib/email-templates';
import { env } from '@/lib/env';
import { clientIp } from '@/lib/request';
import { rateLimited } from '@/lib/security/bot';
import { ipIsThrottled } from '@/lib/security/rate-limit';
import { createOneTimeToken } from '@/lib/tokens';
import { isEmail } from '@/lib/users';
import { fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST { email } → emails a one-time link listing the tickets bought with that address. Same reply either way. */
export const POST = handle(async (req) => {
  const body = await readJson(req, 4 * 1024);
  const email = v.str(body.email, 254, 'email', { required: true }).toLowerCase();
  const ip = await clientIp();
  if (await ipIsThrottled(ip) || rateLimited(`find:${ip}`, 10, 15 * 60_000)) return fail(429, 'Too many attempts from this network. Please try again later.');
  const done = { message: 'If we have tickets for that email, a link is on its way.' };
  if (!isEmail(email)) return json(done);
  const has = await queryOne(
    `SELECT 1 FROM orders WHERE buyer_email = ? AND status IN ('paid','partially_refunded')
     UNION ALL SELECT 1 FROM tickets WHERE attendee_email = ? AND transferred_from_id IS NOT NULL AND status IN ('valid','used') LIMIT 1`,
    [email, email],
  );
  if (!has) return json(done);
  const token = await createOneTimeToken('find_tickets', email, null, null);
  const mail = await renderEmail('tickets_link', { url: `${env.APP_URL}/tickets/list?token=${token}` });
  await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
  return json(done);
});
