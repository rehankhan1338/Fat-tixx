import 'server-only';
import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { execute, query, queryOne, type Row } from './db';
import { formatEventDate, formatTimeOnly } from './tz';

/**
 * Push notifications for the Scan Manager app (Fattixx-app).
 *
 * Flow: the app registers its Expo push token after sign-in (POST /api/mobile/v1/devices) → something happens on the
 * platform → `queuePush` writes one push_outbox row per signed-in device of the people concerned → the rows are sent
 * through Expo's push service right after the current request (`after`) and again by the minute job for anything that
 * failed → about 15 minutes later the job reads Expo's receipts and switches off devices whose app was uninstalled.
 *
 * Who gets what: only people who can work on the event in the app (Organization Admins, Organizers with access to it,
 * and Staff assigned to it). Sales news (sold out) and check-in conflicts go to admins and organizers only: Staff see
 * no financial data. Pushes never contain attendee names or emails; they show on lock screens.
 */

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_ATTEMPTS = 5;

export type PushKind = 'event_published' | 'staff_assigned' | 'doors_soon' | 'event_changed' | 'event_cancelled' | 'event_postponed' | 'sold_out' | 'scan_conflicts' | 'test';
export type PushMessage = { kind: PushKind; title: string; body: string; url?: string | null };

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(token);
}

/** Link a token to the app session that sent it. A token seen before (re-install, other account) moves to this session. */
export async function registerDevice(input: { userId: number; sessionId: string; token: string; platform: 'ios' | 'android' }): Promise<void> {
  await execute(
    `INSERT INTO push_devices (user_id, session_id, token, platform) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), session_id = VALUES(session_id), platform = VALUES(platform), last_seen_at = NOW(), disabled_at = NULL`,
    [input.userId, input.sessionId, input.token, input.platform],
  );
}

/** Notifications switched off on the phone, or sign-out: forget this session's device(s). */
export async function unregisterDevice(sessionId: string, token?: string | null): Promise<number> {
  const r = token
    ? await execute(`DELETE FROM push_devices WHERE session_id = ? AND token = ?`, [sessionId, token])
    : await execute(`DELETE FROM push_devices WHERE session_id = ?`, [sessionId]);
  return r.affectedRows;
}

// ---------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------
/** Queue a notification for every live device of these users. Returns how many devices it was queued for. */
export async function queuePush(userIds: number[], msg: PushMessage): Promise<number> {
  const ids = [...new Set(userIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return 0;
  const r = await execute(
    `INSERT INTO push_outbox (device_id, kind, title, body, url)
     SELECT d.id, ?, ?, ?, ? FROM push_devices d
       JOIN sessions s ON s.id = d.session_id AND s.revoked_at IS NULL AND s.expires_at > NOW()
       JOIN users u ON u.id = d.user_id AND u.status = 'active'
      WHERE d.disabled_at IS NULL AND d.user_id IN (${ids.map(() => '?').join(',')})`,
    [msg.kind, msg.title.slice(0, 120), msg.body.slice(0, 300), msg.url ?? null, ...ids],
  );
  if (r.affectedRows) scheduleDelivery();
  return r.affectedRows;
}

/** Send right after the current response; outside a request (minute job, scripts) send now in the background. */
function scheduleDelivery() {
  if (process.env.PUSH_DELIVERY === 'off') return;
  const run = () => deliverDuePushes().catch((e) => console.error('[push] delivery failed', e));
  try { after(run); } catch { void run(); }
}

type EventInfo = Row & { id: number; title: string; timezone: string; starts_at: Date; doors_at: Date | null; created_by: number | null; org_slug: string };

async function eventInfo(eventId: number): Promise<EventInfo | null> {
  return queryOne<EventInfo>(
    `SELECT e.id, e.title, e.timezone, e.starts_at, e.doors_at, e.created_by, o.slug AS org_slug
       FROM events e JOIN organizations o ON o.id = e.organization_id WHERE e.id = ?`, [eventId],
  );
}

/**
 * Everyone who can work on this event in the app, mirroring authz.canAccessEvent: Organization Admins; Organizers with
 * access to every event, who created it, or who are assigned to it; Staff assigned to it. `managersOnly` leaves out Staff.
 */
export async function eventAudience(eventId: number, opts: { managersOnly?: boolean; exceptUserId?: number | null } = {}): Promise<number[]> {
  const rows = await query<Row & { user_id: number }>(
    `SELECT DISTINCT m.user_id FROM events e
       JOIN organizations o ON o.id = e.organization_id AND o.status = 'active'
       JOIN organization_members m ON m.organization_id = e.organization_id
       JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE e.id = ? AND (
            m.role = 'org_admin'
         OR (m.role = 'organizer' AND (m.all_events = 1 OR e.created_by = m.user_id OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = m.user_id)))
         OR (? = 0 AND m.role = 'staff' AND EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = m.user_id)))`,
    [eventId, opts.managersOnly ? 1 : 0],
  );
  return rows.map((r) => Number(r.user_id)).filter((id) => id !== opts.exceptUserId);
}

const eventUrl = (e: EventInfo) => `/event/${e.org_slug}/${e.id}`;
const when = (e: EventInfo, d: Date) => formatEventDate(new Date(d), e.timezone, { withZone: false });

// ---------------------------------------------------------------------------
// The notifications. Each one is best effort: a push problem never breaks the action that caused it.
// ---------------------------------------------------------------------------
async function safely(label: string, fn: () => Promise<number>): Promise<number> {
  try { return await fn(); } catch (e) { console.error(`[push] ${label} failed`, e); return 0; }
}

/**
 * The event went live and its creator ticked "Send a push notification to the team" (events.push_on_publish).
 * Sent once per event, whichever way it went live; the person who published it is left out.
 */
export function pushEventPublished(eventId: number, actorUserId: number | null): Promise<number> {
  return safely('event_published', async () => {
    const claim = await execute(
      `UPDATE events SET published_push_sent_at = NOW() WHERE id = ? AND status = 'published' AND push_on_publish = 1 AND published_push_sent_at IS NULL`, [eventId],
    );
    if (!claim.affectedRows) return 0;
    const e = await eventInfo(eventId);
    if (!e) return 0;
    return queuePush(await eventAudience(eventId, { exceptUserId: actorUserId }), {
      kind: 'event_published', title: 'New event', body: `${e.title} is now live (${when(e, e.starts_at)}).`, url: eventUrl(e),
    });
  });
}

/** An Organization Admin / Organizer put someone on an event's team. */
export function pushStaffAssigned(eventId: number, userId: number): Promise<number> {
  return safely('staff_assigned', async () => {
    const e = await eventInfo(eventId);
    if (!e) return 0;
    return queuePush([userId], { kind: 'staff_assigned', title: 'New event assigned', body: `You're on the team for ${e.title} (${when(e, e.starts_at)}).`, url: eventUrl(e) });
  });
}

/** Date, time or place changed. `changed` are the labels from events/notify.ts, e.g. ["Date and time", "Location"]. */
export function pushEventChanged(eventId: number, changed: string[], actorUserId: number | null): Promise<number> {
  return safely('event_changed', async () => {
    const e = await eventInfo(eventId);
    if (!e || !changed.length) return 0;
    const what = changed.map((c) => c.toLowerCase()).join(' and ');
    return queuePush(await eventAudience(eventId, { exceptUserId: actorUserId }), {
      kind: 'event_changed', title: 'Event updated', body: `${e.title}: the ${what} changed. It now starts ${when(e, e.starts_at)}.`, url: eventUrl(e),
    });
  });
}

export function pushEventCancelled(eventId: number, actorUserId: number | null): Promise<number> {
  return safely('event_cancelled', async () => {
    const e = await eventInfo(eventId);
    if (!e) return 0;
    return queuePush(await eventAudience(eventId, { exceptUserId: actorUserId }), {
      kind: 'event_cancelled', title: 'Event cancelled', body: `${e.title} has been cancelled. Tickets are no longer valid.`, url: eventUrl(e),
    });
  });
}

export function pushEventPostponed(eventId: number, newStart: Date | null, actorUserId: number | null): Promise<number> {
  return safely('event_postponed', async () => {
    const e = await eventInfo(eventId);
    if (!e) return 0;
    const body = newStart ? `${e.title} moved to ${when(e, newStart)}. Tickets stay valid.` : `${e.title} is postponed. A new date will be announced.`;
    return queuePush(await eventAudience(eventId, { exceptUserId: actorUserId }), { kind: 'event_postponed', title: 'Event postponed', body, url: eventUrl(e) });
  });
}

/** After a paid order: once every public ticket type is gone, tell admins and organizers (once per event). */
export function pushIfSoldOut(eventId: number): Promise<number> {
  return safely('sold_out', async () => {
    const s = await queryOne<Row & { types: number; open: number }>(
      `SELECT COUNT(*) AS types, COALESCE(SUM(sold < quantity), 0) AS open FROM ticket_types WHERE event_id = ? AND hidden = 0`, [eventId],
    );
    if (!s || !Number(s.types) || Number(s.open)) return 0;
    const claim = await execute(`UPDATE events SET sold_out_push_sent_at = NOW() WHERE id = ? AND sold_out_push_sent_at IS NULL`, [eventId]);
    if (!claim.affectedRows) return 0;
    const e = await eventInfo(eventId);
    if (!e) return 0;
    return queuePush(await eventAudience(eventId, { managersOnly: true }), { kind: 'sold_out', title: 'Sold out', body: `${e.title} is sold out.`, url: eventUrl(e) });
  });
}

/** Offline scans that clashed when a device synced: admins and organizers should review them on the event page. */
export function pushScanConflicts(eventId: number, count: number, syncedByUserId: number): Promise<number> {
  return safely('scan_conflicts', async () => {
    if (count <= 0) return 0;
    const e = await eventInfo(eventId);
    if (!e) return 0;
    return queuePush(await eventAudience(eventId, { managersOnly: true, exceptUserId: syncedByUserId }), {
      kind: 'scan_conflicts', title: 'Check-in conflicts', body: `${count} offline ${count === 1 ? 'scan' : 'scans'} at ${e.title} ${count === 1 ? 'needs' : 'need'} review.`, url: eventUrl(e),
    });
  });
}

/** Minute job: about an hour before doors (or the start, without a doors time), remind the team to download the ticket list. */
export async function sendDoorsSoonPushes(): Promise<number> {
  const events = await query<Row & { id: number }>(
    `SELECT id FROM events WHERE status = 'published' AND doors_push_sent_at IS NULL
        AND COALESCE(doors_at, starts_at) BETWEEN NOW() AND NOW() + INTERVAL 60 MINUTE`,
  );
  let queued = 0;
  for (const ev of events) {
    const claim = await execute(`UPDATE events SET doors_push_sent_at = NOW() WHERE id = ? AND doors_push_sent_at IS NULL`, [ev.id]);
    if (!claim.affectedRows) continue;
    queued += await safely('doors_soon', async () => {
      const e = await eventInfo(Number(ev.id));
      if (!e) return 0;
      const at = formatTimeOnly(new Date(e.doors_at ?? e.starts_at), e.timezone);
      return queuePush(await eventAudience(e.id), {
        kind: 'doors_soon', title: e.doors_at ? `Doors open at ${at}` : `Starts at ${at}`,
        body: `${e.title}: open the event and download the ticket list so you can scan without signal.`, url: eventUrl(e),
      });
    });
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Sending through Expo
// ---------------------------------------------------------------------------
type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };
type ExpoReceipt = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

function expoHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  // Optional: with "enhanced push security" on in the Expo project, only requests carrying this token are accepted.
  if (process.env.EXPO_ACCESS_TOKEN) h.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return h;
}

async function retryLater(ids: number[], error: string): Promise<void> {
  if (!ids.length) return;
  await execute(
    // MySQL applies SET assignments left to right, so `attempts` is incremented last (2, 4, 8, 16 minutes between tries).
    `UPDATE push_outbox SET status = IF(attempts + 1 >= ?, 'failed', 'queued'),
            next_attempt_at = NOW() + INTERVAL POW(2, attempts + 1) MINUTE,
            error = ?, claim_token = NULL, claimed_until = NULL, attempts = attempts + 1
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    [MAX_ATTEMPTS, error.slice(0, 255), ...ids],
  );
}

async function disableDevices(deviceIds: number[]): Promise<void> {
  if (!deviceIds.length) return;
  await execute(`UPDATE push_devices SET disabled_at = NOW() WHERE id IN (${deviceIds.map(() => '?').join(',')})`, deviceIds);
}

/** Send what is due (up to `limit` messages). Safe to run from several servers at once: rows are claimed first. */
export async function deliverDuePushes(limit = 500): Promise<{ sent: number; failed: number }> {
  const claim = randomBytes(12).toString('hex');
  const claimed = await execute(
    `UPDATE push_outbox SET claim_token = ?, claimed_until = NOW() + INTERVAL 2 MINUTE
      WHERE status = 'queued' AND next_attempt_at <= NOW() AND (claimed_until IS NULL OR claimed_until < NOW())
      ORDER BY id LIMIT ?`, [claim, limit],
  );
  if (!claimed.affectedRows) return { sent: 0, failed: 0 };
  const rows = await query<Row & { id: number; device_id: number; title: string; body: string; url: string | null; token: string | null; live: number }>(
    `SELECT p.id, p.device_id, p.title, p.body, p.url, d.token,
            (d.disabled_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS live
       FROM push_outbox p JOIN push_devices d ON d.id = p.device_id LEFT JOIN sessions s ON s.id = d.session_id
      WHERE p.claim_token = ? ORDER BY p.id`, [claim],
  );
  // Signed out (or uninstalled) since it was queued: drop it.
  const dead = rows.filter((r) => !Number(r.live)).map((r) => Number(r.id));
  if (dead.length) await execute(`UPDATE push_outbox SET status = 'failed', error = 'device signed out', claim_token = NULL WHERE id IN (${dead.map(() => '?').join(',')})`, dead);

  let sent = 0, failed = dead.length;
  const live = rows.filter((r) => Number(r.live));
  for (let i = 0; i < live.length; i += 100) {
    const batch = live.slice(i, i + 100);
    const messages = batch.map((r) => ({
      to: r.token, title: r.title, body: r.body, data: r.url ? { url: r.url } : {}, sound: 'default', priority: 'high', channelId: 'default',
    }));
    let tickets: ExpoTicket[];
    try {
      const res = await fetch(EXPO_SEND_URL, { method: 'POST', headers: expoHeaders(), body: JSON.stringify(messages), signal: AbortSignal.timeout(15_000) });
      const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: { message?: string }[] } | null;
      if (!res.ok || !Array.isArray(json?.data) || json.data.length !== batch.length) {
        throw new Error(json?.errors?.[0]?.message ?? `Expo push service returned ${res.status}`);
      }
      tickets = json.data;
    } catch (e) {
      await retryLater(batch.map((r) => Number(r.id)), (e as Error).message || 'network error');
      continue;
    }
    const gone: number[] = [], retry: number[] = [];
    for (let j = 0; j < batch.length; j++) {
      const t = tickets[j], row = batch[j];
      if (t.status === 'ok') {
        await execute(`UPDATE push_outbox SET status = 'sent', expo_ticket_id = ?, sent_at = NOW(), attempts = attempts + 1, error = NULL, claim_token = NULL WHERE id = ?`, [t.id, row.id]);
        sent++;
      } else if (t.details?.error === 'DeviceNotRegistered') {
        await execute(`UPDATE push_outbox SET status = 'failed', error = 'DeviceNotRegistered', claim_token = NULL WHERE id = ?`, [row.id]);
        gone.push(Number(row.device_id));
        failed++;
      } else {
        retry.push(Number(row.id));
      }
    }
    await disableDevices(gone);
    await retryLater(retry, 'Expo rejected the message');
  }
  return { sent, failed };
}

/** Read Expo's delivery receipts for messages sent 15 min – 24 h ago (Expo keeps receipts for a day). */
export async function checkPushReceipts(limit = 1000): Promise<{ delivered: number; failed: number }> {
  const rows = await query<Row & { id: number; device_id: number; expo_ticket_id: string }>(
    `SELECT id, device_id, expo_ticket_id FROM push_outbox
      WHERE status = 'sent' AND expo_ticket_id IS NOT NULL AND sent_at < NOW() - INTERVAL 15 MINUTE AND sent_at > NOW() - INTERVAL 1 DAY
      ORDER BY id LIMIT ?`, [limit],
  );
  if (!rows.length) return { delivered: 0, failed: 0 };
  let receipts: Record<string, ExpoReceipt>;
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids: rows.map((r) => r.expo_ticket_id) }), signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => null)) as { data?: Record<string, ExpoReceipt> } | null;
    if (!res.ok || !json?.data) return { delivered: 0, failed: 0 };
    receipts = json.data;
  } catch {
    return { delivered: 0, failed: 0 };
  }
  let delivered = 0, failed = 0;
  const gone: number[] = [];
  for (const r of rows) {
    const rc = receipts[r.expo_ticket_id];
    if (!rc) continue; // not ready yet
    if (rc.status === 'ok') {
      await execute(`UPDATE push_outbox SET status = 'delivered' WHERE id = ?`, [r.id]);
      delivered++;
    } else {
      const code = rc.details?.error ?? 'error';
      await execute(`UPDATE push_outbox SET status = 'failed', error = ? WHERE id = ?`, [`${code}: ${rc.message ?? ''}`.slice(0, 255), r.id]);
      if (code === 'DeviceNotRegistered') gone.push(Number(r.device_id));
      failed++;
    }
  }
  await disableDevices(gone);
  return { delivered, failed };
}

/** Called by runJobs() every minute. */
export async function runPushJobs(): Promise<{ doorsSoon: number; sent: number; failed: number; delivered: number }> {
  const doorsSoon = await sendDoorsSoonPushes();
  const d = await deliverDuePushes();
  const r = await checkPushReceipts();
  return { doorsSoon, sent: d.sent, failed: d.failed + r.failed, delivered: r.delivered };
}

/** Daily housekeeping: keep a month of history. */
export async function prunePushOutbox(): Promise<void> {
  await execute(`DELETE FROM push_outbox WHERE created_at < NOW() - INTERVAL 30 DAY LIMIT 5000`);
}
