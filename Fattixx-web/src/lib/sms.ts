import 'server-only';
import { execute } from './db';

/**
 * SMS ticket delivery and reminders (Phase 2). Like email, every message is written to `sms_outbox`
 * first. Delivery goes through Twilio's REST API when these are set; otherwise the message is only
 * logged (visible under Admin → Emails → SMS), so the flow works on localhost.
 *
 *   TWILIO_ACCOUNT_SID=AC...
 *   TWILIO_AUTH_TOKEN=...
 *   TWILIO_FROM=+18435550123        (or a Messaging Service SID starting with MG)
 */
export function isSmsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

/** Loose E.164 normalisation for US numbers typed by buyers: "(843) 555-0123" → "+18435550123". */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  const d = digits.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

export async function sendSms(to: string, body: string, related?: { type: string; id: string | number }): Promise<number | null> {
  const phone = normalizePhone(to);
  if (!phone) return null;
  const text = body.slice(0, 640);
  const r = await execute(`INSERT INTO sms_outbox (to_phone, body, related_type, related_id) VALUES (?, ?, ?, ?)`, [phone, text, related?.type ?? null, related ? String(related.id) : null]);
  const id = r.insertId;
  if (!isSmsConfigured()) {
    await execute(`UPDATE sms_outbox SET status = 'logged' WHERE id = ?`, [id]);
    return id;
  }
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const from = process.env.TWILIO_FROM!;
    const form = new URLSearchParams({ To: phone, Body: text, ...(from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) throw new Error(json.message ?? `Twilio HTTP ${res.status}`);
    await execute(`UPDATE sms_outbox SET status = 'sent', sent_at = NOW(), provider_id = ? WHERE id = ?`, [json.sid ?? null, id]);
  } catch (e) {
    await execute(`UPDATE sms_outbox SET status = 'failed', error = ? WHERE id = ?`, [String((e as Error).message).slice(0, 500), id]);
  }
  return id;
}
