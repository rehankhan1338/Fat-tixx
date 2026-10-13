"use client";

import type { OfflineScan, ScannerSnapshot } from "./checkin/actions";

/**
 * Browser-side storage for the offline scanner (IndexedDB). Holds one ticket snapshot per event and
 * the queue of check-ins made while offline. Data is removed after the event and on sign-out
 * (plan 10.3), and every access tolerates IndexedDB being unavailable (private mode).
 */
const DB_NAME = "fattixx-scanner";
const SNAPSHOTS = "snapshots";
const QUEUE = "queue";

export type QueuedScan = OfflineScan & { eventId: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "eventId" });
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "ref" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSnapshot(s: ScannerSnapshot): Promise<void> {
  try { await tx(SNAPSHOTS, "readwrite", (st) => st.put(s)); } catch { /* storage unavailable */ }
}

export async function loadSnapshot(eventId: number): Promise<ScannerSnapshot | null> {
  try {
    const s = (await tx<ScannerSnapshot>(SNAPSHOTS, "readonly", (st) => st.get(eventId) as IDBRequest<ScannerSnapshot>)) ?? null;
    if (s && Date.parse(s.expiresAt) < Date.now()) { await tx(SNAPSHOTS, "readwrite", (st) => st.delete(eventId)); return null; }
    return s;
  } catch { return null; }
}

export async function enqueueScan(item: QueuedScan): Promise<void> {
  try { await tx(QUEUE, "readwrite", (st) => st.put(item)); } catch { /* storage unavailable: the in-memory copy still syncs */ }
}

export async function queuedScans(eventId: number): Promise<QueuedScan[]> {
  try {
    const all = (await tx<QueuedScan[]>(QUEUE, "readonly", (st) => st.getAll() as IDBRequest<QueuedScan[]>)) ?? [];
    return all.filter((q) => q.eventId === eventId);
  } catch { return []; }
}

export async function dropQueued(refs: string[]): Promise<void> {
  if (!refs.length) return;
  try { await tx(QUEUE, "readwrite", (st) => { for (const r of refs) st.delete(r); }); } catch { /* ignore */ }
}

/** Remove every downloaded ticket list. Queued scans that never synced are kept so no check-in is lost. */
export async function clearOfflineScanData(): Promise<void> {
  try { await tx(SNAPSHOTS, "readwrite", (st) => st.clear()); } catch { /* ignore */ }
}

/** Stable random id for this browser, recorded with every offline check-in. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem("fx_device_id");
    if (!id) { id = crypto.randomUUID().replace(/-/g, "").slice(0, 16); localStorage.setItem("fx_device_id", id); }
    return id;
  } catch { return "unknown"; }
}

export function newRef(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Same hash the server stores (sha256 of the full signed payload, first 32 hex chars). Null where Web Crypto is unavailable. */
export async function payloadHash(payload: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.trim()));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
