import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useNetworkState } from 'expo-network';
import { api, ApiError } from '@/api/client';
import type { OfflineTicket, ScanResult, ScannerSnapshot, SyncResult } from '@/api/types';
import { deviceId, dropQueued, findTicket, localCounts, newRef, payloadHash, queuedScans, recordOfflineCheckin, saveSnapshot, snapshotMeta, type SnapshotMeta } from './store';

/**
 * Offline mode for the door scanner (plan 8.2), shared by Android and iOS.
 *
 * While the phone is online every scan goes to the server as before. The hook keeps a copy of the event's
 * ticket list on the device (refreshed every minute and whenever the app returns to the foreground), so
 * when the connection drops the scanner validates against that copy: unknown codes, forged QR codes
 * (payload hash mismatch), refunded / transferred tickets, wrong day and duplicates are all caught locally.
 * Admissions made offline are queued and uploaded as soon as the network is back; the server flags any
 * that collided with another device or a later refund for the organiser to review.
 */
export type Counts = { total: number; used: number };

export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.isNetwork;
}

function ticketView(t: OfflineTicket): NonNullable<ScanResult['ticket']> {
  return { id: t.id, code: t.code, attendeeName: t.attendeeName, ticketType: t.ticketType, seatLabel: t.seatLabel, dayLabel: t.dayLabel, addons: t.addons, checkedInAt: null, checkedInBy: null, orderCode: t.orderCode, buyerEmail: t.buyerEmail };
}

export function useOfflineScanner(org: string, eventId: number, onCounts: (c: Counts) => void) {
  const net = useNetworkState();
  const osOffline = net.isConnected === false || net.isInternetReachable === false;
  const [reachable, setReachable] = useState(true);
  const [list, setList] = useState<SnapshotMeta | null>(null);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const onCountsRef = useRef(onCounts);
  useEffect(() => { onCountsRef.current = onCounts; }, [onCounts]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 8000);
  }, []);

  const refreshQueued = useCallback(async () => {
    const q = await queuedScans(eventId);
    setQueued(q.length);
    return q;
  }, [eventId]);

  /** Download the event's ticket list and store it. */
  const download = useCallback(async (): Promise<boolean> => {
    setDownloading(true);
    try {
      const s = await api<ScannerSnapshot>(`/scan/${org}/${eventId}/snapshot`, { timeoutMs: 45_000 });
      await saveSnapshot(s);
      setList(await snapshotMeta(eventId));
      setReachable(true);
      return true;
    } catch (e) {
      if (isNetworkError(e)) setReachable(false);
      else showNotice((e as Error).message);
      return false;
    } finally {
      setDownloading(false);
    }
  }, [org, eventId, showNotice]);

  /** Upload queued offline check-ins. Rows leave the queue only once the server has confirmed them. */
  const upload = useCallback(async (): Promise<boolean> => {
    const items = await refreshQueued();
    if (!items.length) return true;
    setSyncing(true);
    try {
      const body = { deviceId: await deviceId(), items: items.map(({ ref, ticketId, kind, at }) => ({ ref, ticketId, kind, at })) };
      const r = await api<SyncResult>(`/scan/${org}/${eventId}/sync`, { method: 'POST', body, timeoutMs: 30_000 });
      await dropQueued(items.map((i) => i.ref));
      setQueued(0);
      onCountsRef.current(r.counts);
      setReachable(true);
      const n = r.synced;
      showNotice(r.conflicts.length ? `${n} offline check-in${n === 1 ? '' : 's'} uploaded · ${r.conflicts.length} flagged for the organiser to review` : `${n} offline check-in${n === 1 ? '' : 's'} uploaded`);
      return true;
    } catch (e) {
      if (isNetworkError(e)) setReachable(false);
      else showNotice((e as Error).message);
      return false;
    } finally {
      setSyncing(false);
    }
  }, [org, eventId, refreshQueued, showNotice]);

  /** Upload first (so the fresh list already reflects this device's check-ins), then refresh the list. */
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (await upload()) await download();
    } finally {
      busy.current = false;
    }
  }, [upload, download]);

  // On open: show what is already on the phone right away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await snapshotMeta(eventId);
      if (!cancelled) setList(m);
      if (!cancelled) await refreshQueued();
    })();
    return () => { cancelled = true; };
  }, [eventId, refreshQueued]);

  // Whenever the OS reports a connection: sync now, then every minute, and when the app comes back to the front.
  // A successful upload or download is what marks the server reachable again.
  useEffect(() => {
    if (osOffline) return;
    void sync();
    const iv = setInterval(() => void sync(), 60_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void sync(); });
    return () => { clearInterval(iv); sub.remove(); };
  }, [osOffline, sync]);

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  /** Validate a scan against the stored list and queue the admission for upload. */
  const offlineCheck = useCallback(async (match: { payload?: string; ticketId?: number }, kind: 'valid' | 'manual', current: Counts | null): Promise<ScanResult> => {
    const meta = await snapshotMeta(eventId);
    const c = current ?? (await localCounts(eventId)) ?? { total: 0, used: 0 };
    if (!meta) return { result: 'invalid', counts: c, message: 'Offline, and this phone has no ticket list for the event. Open the event once while online to download it.' };
    let t: OfflineTicket | null = null;
    if (match.ticketId != null) {
      t = await findTicket(eventId, { ticketId: match.ticketId });
    } else if (match.payload) {
      const p = match.payload.trim();
      if (p.startsWith('FTX1.')) {
        t = await findTicket(eventId, { code: p.split('.')[1] ?? '' });
        // The stored hash covers code, secret and signature, so a QR with a real code but a made-up rest fails here.
        if (t && t.h !== (await payloadHash(p))) return { result: 'invalid', counts: c, message: 'QR code does not match this ticket (offline check).' };
      } else if (/^[A-Z0-9]{12}$/i.test(p)) {
        t = await findTicket(eventId, { code: p.toUpperCase() });
      }
    }
    if (!t) return { result: 'invalid', counts: c, message: "Not on this event's downloaded list (offline)." };
    const view = ticketView(t);
    if (t.status === 'refunded' || t.status === 'cancelled' || t.status === 'transferred') return { result: t.status, ticket: view, counts: c, message: `Ticket was ${t.status} (offline list).` };
    const isPass = t.dateId == null;
    if (!isPass && meta.activeDateId != null && t.dateId !== meta.activeDateId) return { result: 'wrong_day', ticket: view, counts: c, message: `This ticket is for ${t.dayLabel ?? 'another day'} (offline).` };
    const usedToday = t.status === 'used' && (!isPass || meta.activeDateId == null || t.lastDateId === meta.activeDateId);
    if (usedToday) return { result: 'already_used', ticket: view, counts: c, message: 'Already checked in (offline list).' };
    await recordOfflineCheckin({ ref: newRef(), eventId, ticketId: t.id, kind, at: new Date().toISOString() }, meta.activeDateId);
    setQueued((n) => n + 1);
    const next = t.status === 'valid' ? { ...c, used: c.used + 1 } : c;
    return { result: kind, ticket: view, ageRestriction: meta.ageRestriction, counts: next, message: 'Admitted offline. Will upload when the connection returns.' };
  }, [eventId]);

  return {
    /** Best current knowledge: false once the OS reports no connection or a request to the server failed to connect. */
    online: reachable && !osOffline,
    list, queued, syncing, downloading, notice,
    sync, offlineCheck,
    markUnreachable: () => setReachable(false),
  };
}
