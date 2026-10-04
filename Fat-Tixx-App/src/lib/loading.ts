import { useSyncExternalStore } from 'react';

/**
 * Manual "busy" signals for work React Query does not know about (web view page loads, offline ticket
 * list downloads). Each key is independent; the top progress bar runs while any key is on.
 */
const busy = new Set<string>();
const listeners = new Set<() => void>();

export function setBusy(key: string, on: boolean) {
  const had = busy.has(key);
  if (on === had) return;
  if (on) busy.add(key); else busy.delete(key);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useManualBusy(): boolean {
  return useSyncExternalStore(subscribe, () => busy.size > 0, () => false);
}
