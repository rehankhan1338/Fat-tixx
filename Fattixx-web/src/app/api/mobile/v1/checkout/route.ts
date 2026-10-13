import { audit } from '@/lib/audit';
import { getPublicEventBySlug, listQuestions, questionOptions } from '@/lib/events/queries';
import { createPendingOrder, type AnswerInput } from '@/lib/orders/checkout';
import { isAdmitted } from '@/lib/queue';
import { clientIp } from '@/lib/request';
import { rateLimited } from '@/lib/security/bot';
import { ipIsThrottled } from '@/lib/security/rate-limit';
import { isEmail } from '@/lib/users';
import { ApiError, fail, handle, json, optionalUser, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * POST → reserve tickets (10-minute hold) and return the order to pay for.
 * Body: { eventSlug, lines: [{ticketTypeId, quantity}], addons?: [{addonId, quantity}], answers?: [{questionId, answer}],
 *         email, name, phone?, accessCode?, promoCode?, marketing?, sms?, startedAt? }
 * Response: { code, accessToken, totalCents, currency, holdExpiresAt, free }
 * The access token is the buyer's proof of ownership for this order (same model as the emailed link on the web).
 */
export const POST = handle(async (req) => {
  const body = await readJson(req, 32 * 1024);
  const ip = await clientIp();
  if (await ipIsThrottled(ip) || rateLimited(`checkout:${ip}`, 30, 10 * 60_000)) return fail(429, 'Too many attempts from this network. Please try again later.');
  const startedAt = typeof body.startedAt === 'number' ? body.startedAt : 0;
  if (startedAt && Date.now() - startedAt < 800) return fail(400, 'Something went wrong with that submission. Please wait a moment and try again.');

  const eventSlug = v.slug(body.eventSlug, 'event');
  const lines = v.array(body.lines, 'tickets', 50, (x) => { const o = v.obj(x, 'tickets'); return { ticketTypeId: v.int(o.ticketTypeId, 'ticket', { min: 1 }), quantity: v.int(o.quantity, 'quantity', { min: 1, max: 100 }) }; });
  const addons = v.array(body.addons, 'add-ons', 50, (x) => { const o = v.obj(x, 'add-ons'); return { addonId: v.int(o.addonId, 'add-on', { min: 1 }), quantity: v.int(o.quantity, 'quantity', { min: 1, max: 100 }) }; });
  if (lines.length === 0) throw new ApiError(400, 'Choose at least one ticket.');
  const email = v.str(body.email, 254, 'email', { required: true });
  const name = v.str(body.name, 160, 'name', { required: true, min: 2 });
  if (!isEmail(email)) throw new ApiError(400, 'Enter a valid email address so we can send your tickets.', 'email');
  const phone = v.str(body.phone, 40, 'phone');

  const event = await getPublicEventBySlug(eventSlug);
  if (!event) return fail(404, 'Event not found.');
  if (event.queue_enabled && !(await isAdmitted(event.id))) return fail(409, 'Your turn in the waiting room has expired. Rejoin the line to continue.');

  // Checkout questions: validate required ones and snapshot the labels (same rules as the website).
  const given = v.array(body.answers, 'answers', 50, (x) => { const o = v.obj(x, 'answers'); return { questionId: v.int(o.questionId, 'question', { min: 1 }), answer: v.str(o.answer, 1000, 'answer') }; });
  const answers: AnswerInput[] = [];
  for (const q of await listQuestions(event.id)) {
    const raw = given.find((a) => a.questionId === Number(q.id))?.answer ?? '';
    const value = q.kind === 'checkbox' ? (raw && raw !== 'false' && raw !== '0' ? 'Yes' : '') : raw;
    if (q.kind === 'select' && value && !questionOptions(q).includes(value)) throw new ApiError(400, `Choose one of the options for “${q.label}”.`);
    if (q.required && !value) throw new ApiError(400, q.kind === 'checkbox' ? `Please confirm “${q.label}”.` : `Please answer “${q.label}”.`);
    if (value) answers.push({ questionId: Number(q.id), label: q.label, answer: value });
  }

  const session = await optionalUser();
  const r = await createPendingOrder({
    eventSlug, lines, addons, answers, accessCode: v.str(body.accessCode, 40) || null, promoCode: v.str(body.promoCode, 40) || null,
    email, name, phone, marketingOptIn: v.bool(body.marketing), smsOptIn: v.bool(body.sms), userId: session?.user.id ?? null, ip,
    attribution: { utmSource: 'fattixx_app', utmMedium: 'app', channel: 'web' },
  });
  await audit('order.created', { actorUserId: session?.user.id ?? null, targetType: 'order', targetId: r.orderId, metadata: { code: r.code, total: r.totalCents, discount: r.discountCents, channel: 'app' } });
  return json({ code: r.code, accessToken: r.accessToken, totalCents: r.totalCents, currency: event.currency, free: r.totalCents === 0 });
});
