import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import type { OfflineScan, OfflineTicket, ScannerSnapshot } from '@/api/types';

/**
 * On-device storage for the offline scanner (SQLite, identical on Android and iOS).
 *
 *  - `snapshots` / `tickets`: one downloaded ticket list per event. Each ticket carries only a hash of its
 *    signed QR payload, so the phone cannot be used to forge tickets even if it is lost.
 *  - `queue`: check-ins recorded while offline, uploaded through `/scan/:org/:event/sync`. Rows are removed
 *    only after the server confirms them, so a connection dropping mid-upload never loses a check-in.
 *  - `meta`: the stable device id recorded with every offline check-in.
 *
 * Lists expire 24 h after the event ends (server-provided `expiresAt`) and are deleted on sign-out. Queued
 * check-ins survive sign-out so nothing is lost; they sync under whoever signs in next on this device.
 * The in-memory fallback keeps the scanner usable where SQLite is unavailable (web preview).
 */
const DB_NAME = 'fattixx-scanner.db';
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS snapshots (event_id INTEGER PRIMARY KEY, generated_at TEXT NOT NULL, expires_at TEXT NOT NULL, active_date_id INTEGER, age_restriction INTEGER, ticket_count INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tickets (event_id INTEGER NOT NULL, id INTEGER NOT NULL, code TEXT NOT NULL, h TEXT NOT NULL, status TEXT NOT NULL, date_id INTEGER, last_date_id INTEGER, data TEXT NOT NULL, PRIMARY KEY (event_id, id));
  CREATE INDEX IF NOT EXISTS tickets_by_code ON tickets (event_id, code);
  CREATE TABLE IF NOT EXISTS queue (ref TEXT PRIMARY KEY, event_id INTEGER NOT NULL, ticket_id INTEGER NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS queue_by_event ON queue (event_id);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export type SnapshotMeta = { eventId: number; generatedAt: string; expiresAt: string; activeDateId: number | null; ageRestriction: number | null; ticketCount: number };
export type QueuedScan = OfflineScan & { eventId: number };
export type OfflineStatus = Record<number, { downloaded: boolean; queued: number }>;

type TicketRow = { id: number; code: string; h: string; status: string; date_id: number | null; last_date_id: number | null; data: string };
type SnapshotRow = { generated_at: string; expires_at: string; active_date_id: number | null; age_restriction: number | null; ticket_count: number };

let dbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase | null> {
  if (Platform.OS === 'web') return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const d = await SQLite.openDatabaseAsync(DB_NAME);
        await d.execAsync(SCHEMA);
        return d;
      } catch (e) {
        console.warn('[scanner] SQLite unavailable, using in-memory store:', (e as Error)?.message);
        return null;
      }
    })();
  }
  return dbPromise;
}

// In-memory fallback (never the primary path on a phone).
const mem = { snapshots: new Map<number, ScannerSnapshot>(), queue: new Map<string, QueuedScan>(), deviceId: '' };

function rowToTicket(r: TicketRow): OfflineTicket {
  const t = JSON.parse(r.data) as OfflineTicket;
  return { ...t, id: Number(r.id), code: r.code, h: r.h, status: r.status, dateId: r.date_id == null ? null : Number(r.date_id), lastDateId: r.last_date_id == null ? null : Number(r.last_date_id) };
}

/** Replace the stored list for an event. Check-ins still queued on this device stay applied on top of the fresh copy. */
export async function saveSnapshot(s: ScannerSnapshot): Promise<void> {
  const pending = new Set((await queuedScans(s.eventId)).map((q) => q.ticketId));
  const tickets = s.tickets.map((t) => (pending.has(t.id) && (t.status === 'valid' || t.status === 'used') ? { ...t, status: 'used', lastDateId: s.activeDateId } : t));
  const d = await db();
  if (!d) { mem.snapshots.set(s.eventId, { ...s, tickets }); return; }
  await d.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM tickets WHERE event_id = ?', [s.eventId]);
    const stmt = await tx.prepareAsync('INSERT INTO tickets (event_id, id, code, h, status, date_id, last_date_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    try {
      for (const t of tickets) {
        const { id, code, h, status, dateId, lastDateId, ...rest } = t;
        await stmt.executeAsync([s.eventId, id, code, h, status, dateId, lastDateId, JSON.stringify(rest)]);
      }
    } finally {
      await stmt.finalizeAsync();
    }
    await tx.runAsync(
      'INSERT OR REPLACE INTO snapshots (event_id, generated_at, expires_at, active_date_id, age_restriction, ticket_count) VALUES (?, ?, ?, ?, ?, ?)',
      [s.eventId, s.generatedAt, s.expiresAt, s.activeDateId, s.ageRestriction, tickets.length],
    );
  });
}

/** What is stored for an event, or null when nothing is (an expired list is deleted on the way). */
export async function snapshotMeta(eventId: number): Promise<SnapshotMeta | null> {
  const d = await db();
  let m: SnapshotMeta | null = null;
  if (!d) {
    const s = mem.snapshots.get(eventId);
    m = s ? { eventId, generatedAt: s.generatedAt, expiresAt: s.expiresAt, activeDateId: s.activeDateId, ageRestriction: s.ageRestriction, ticketCount: s.tickets.length } : null;
  } else {
    const r = await d.getFirstAsync<SnapshotRow>('SELECT * FROM snapshots WHERE event_id = ?', [eventId]);
    m = r
      ? { eventId, generatedAt: r.generated_at, expiresAt: r.expires_at, activeDateId: r.active_date_id == null ? null : Number(r.active_date_id), ageRestriction: r.age_restriction == null ? null : Number(r.age_restriction), ticketCount: Number(r.ticket_count) }
      : null;
  }
  if (m && Date.parse(m.expiresAt) < Date.now()) { await dropSnapshot(eventId); return null; }
  return m;
}

export async function dropSnapshot(eventId: number): Promise<void> {
  const d = await db();
  if (!d) { mem.snapshots.delete(eventId); return; }
  await d.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM tickets WHERE event_id = ?', [eventId]);
    await tx.runAsync('DELETE FROM snapshots WHERE event_id = ?', [eventId]);
  });
}

/** Find a stored ticket by id or by its 12-character code. */
export async function findTicket(eventId: number, by: { ticketId: number } | { code: string }): Promise<OfflineTicket | null> {
  const d = await db();
  if (!d) {
    const s = mem.snapshots.get(eventId);
    return s?.tickets.find((t) => ('ticketId' in by ? t.id === by.ticketId : t.code === by.code)) ?? null;
  }
  const r = 'ticketId' in by
    ? await d.getFirstAsync<TicketRow>('SELECT * FROM tickets WHERE event_id = ? AND id = ?', [eventId, by.ticketId])
    : await d.getFirstAsync<TicketRow>('SELECT * FROM tickets WHERE event_id = ? AND code = ?', [eventId, by.code]);
  return r ? rowToTicket(r) : null;
}

/** Counts from the stored list in the server's shape: total = valid + used, used = used. Null without a list. */
export async function localCounts(eventId: number): Promise<{ total: number; used: number } | null> {
  const d = await db();
  if (!d) {
    const s = mem.snapshots.get(eventId);
    if (!s) return null;
    return { total: s.tickets.filter((t) => t.status === 'valid' || t.status === 'used').length, used: s.tickets.filter((t) => t.status === 'used').length };
  }
  const r = await d.getFirstAsync<{ total: number | null; used: number | null }>(
    "SELECT SUM(CASE WHEN status IN ('valid','used') THEN 1 ELSE 0 END) AS total, SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used FROM tickets WHERE event_id = ?",
    [eventId],
  );
  if (!r || r.total == null) return null;
  return { total: Number(r.total), used: Number(r.used ?? 0) };
}

/** Record an offline admission: mark the ticket used locally and queue it for upload, in one transaction. */
export async function recordOfflineCheckin(item: QueuedScan, activeDateId: number | null): Promise<void> {
  const d = await db();
  if (!d) {
    const t = mem.snapshots.get(item.eventId)?.tickets.find((x) => x.id === item.ticketId);
    if (t) { t.status = 'used'; t.lastDateId = activeDateId; }
    mem.queue.set(item.ref, item);
    return;
  }
  await d.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("UPDATE tickets SET status = 'used', last_date_id = ? WHERE event_id = ? AND id = ?", [activeDateId, item.eventId, item.ticketId]);
    await tx.runAsync('INSERT OR REPLACE INTO queue (ref, event_id, ticket_id, kind, at) VALUES (?, ?, ?, ?, ?)', [item.ref, item.eventId, item.ticketId, item.kind, item.at]);
  });
}

export async function queuedScans(eventId: number): Promise<QueuedScan[]> {
  const d = await db();
  if (!d) return [...mem.queue.values()].filter((q) => q.eventId === eventId);
  const rows = await d.getAllAsync<{ ref: string; event_id: number; ticket_id: number; kind: string; at: string }>('SELECT * FROM queue WHERE event_id = ? ORDER BY at', [eventId]);
  return rows.map((r) => ({ ref: r.ref, eventId: Number(r.event_id), ticketId: Number(r.ticket_id), kind: r.kind === 'manual' ? 'manual' : 'valid', at: r.at }));
}

export async function dropQueued(refs: string[]): Promise<void> {
  if (!refs.length) return;
  const d = await db();
  if (!d) { for (const r of refs) mem.queue.delete(r); return; }
  await d.withExclusiveTransactionAsync(async (tx) => {
    for (const r of refs) await tx.runAsync('DELETE FROM queue WHERE ref = ?', [r]);
  });
}

/** Per-event offline state for the event picker: is a list downloaded, and how many check-ins await upload. */
export async function offlineStatus(): Promise<OfflineStatus> {
  const out: OfflineStatus = {};
  const d = await db();
  if (!d) {
    for (const [id] of mem.snapshots) out[id] = { downloaded: true, queued: 0 };
    for (const q of mem.queue.values()) (out[q.eventId] ??= { downloaded: false, queued: 0 }).queued++;
    return out;
  }
  const now = new Date().toISOString();
  for (const r of await d.getAllAsync<{ event_id: number }>('SELECT event_id FROM snapshots WHERE expires_at >= ?', [now])) out[Number(r.event_id)] = { downloaded: true, queued: 0 };
  for (const r of await d.getAllAsync<{ event_id: number; n: number }>('SELECT event_id, COUNT(*) AS n FROM queue GROUP BY event_id')) (out[Number(r.event_id)] ??= { downloaded: false, queued: 0 }).queued = Number(r.n);
  return out;
}

/** Remove every downloaded ticket list (sign-out). Queued check-ins are kept so none is lost. */
export async function clearOfflineSnapshots(): Promise<void> {
  const d = await db();
  if (!d) { mem.snapshots.clear(); return; }
  await d.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM tickets');
    await tx.runAsync('DELETE FROM snapshots');
    await tx.runAsync("DELETE FROM meta WHERE k = 'scan_events'");
  });
}

/** The last event list the scanner tab fetched, so the picker still works after a cold start with no signal. */
export async function rememberScanEvents(events: unknown[]): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.runAsync("INSERT OR REPLACE INTO meta (k, v) VALUES ('scan_events', ?)", [JSON.stringify(events.slice(0, 200))]);
}

export async function rememberedScanEvents<T>(): Promise<T[]> {
  const d = await db();
  if (!d) return [];
  const r = await d.getFirstAsync<{ v: string }>("SELECT v FROM meta WHERE k = 'scan_events'");
  try {
    const list = r?.v ? (JSON.parse(r.v) as T[]) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function forgetScanEvents(): Promise<void> {
  const d = await db();
  if (d) await d.runAsync("DELETE FROM meta WHERE k = 'scan_events'");
}

/** Stable random id for this installation, recorded with every offline check-in. */
export async function deviceId(): Promise<string> {
  const d = await db();
  if (!d) {
    if (!mem.deviceId) mem.deviceId = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return mem.deviceId;
  }
  const r = await d.getFirstAsync<{ v: string }>("SELECT v FROM meta WHERE k = 'device_id'");
  if (r?.v) return r.v;
  const id = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await d.runAsync("INSERT OR REPLACE INTO meta (k, v) VALUES ('device_id', ?)", [id]);
  return id;
}

/** Unique reference per offline check-in; the server de-duplicates on it. */
export function newRef(): string {
  return `${Date.now().toString(36)}-${Crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Same hash the server stores for each ticket: sha256 of the full signed payload, first 32 hex chars. */
export async function payloadHash(payload: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload.trim(), { encoding: Crypto.CryptoEncoding.HEX });
  return hex.slice(0, 32);
}
