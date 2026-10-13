import * as SecureStore from 'expo-secure-store';

/**
 * Everything secret on the device goes through the OS keychain (iOS) / Keystore-backed storage (Android):
 * the session token and the per-order access tokens of guest purchases. Nothing sensitive is ever written
 * to AsyncStorage, logs or the file system. Values are kept small (SecureStore caps a value at 2 KB).
 */
const SESSION_KEY = 'fx.session.token';
const ORDERS_KEY = 'fx.orders.v1';
const QUEUE_KEY_PREFIX = 'fx.queue.';
const MAX_REMEMBERED_ORDERS = 20;

const opts: SecureStore.SecureStoreOptions = {
  // Available after the first unlock; the app does not need the token while the phone is locked.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function getSessionToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(SESSION_KEY, opts); } catch { return null; }
}

export async function setSessionToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(SESSION_KEY, token, opts);
  else await SecureStore.deleteItemAsync(SESSION_KEY, opts).catch(() => {});
}

export type RememberedOrder = { code: string; t: string; title: string; when: string; at: number };

export async function listRememberedOrders(): Promise<RememberedOrder[]> {
  try {
    const raw = await SecureStore.getItemAsync(ORDERS_KEY, opts);
    const list = raw ? (JSON.parse(raw) as RememberedOrder[]) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** Remember a purchase made on this device so its tickets open without an account (most recent first). */
export async function rememberOrder(o: RememberedOrder): Promise<void> {
  const list = (await listRememberedOrders()).filter((x) => x.code !== o.code);
  list.unshift({ ...o, title: o.title.slice(0, 60), when: o.when.slice(0, 40) });
  await SecureStore.setItemAsync(ORDERS_KEY, JSON.stringify(list.slice(0, MAX_REMEMBERED_ORDERS)), opts);
}

export async function forgetOrders(): Promise<void> {
  await SecureStore.deleteItemAsync(ORDERS_KEY, opts).catch(() => {});
}

export async function rememberedOrderToken(code: string): Promise<string | null> {
  return (await listRememberedOrders()).find((o) => o.code === code)?.t ?? null;
}

/** Virtual waiting-room place for an event (short-lived; the server expires it). */
export async function getQueueToken(slug: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync(QUEUE_KEY_PREFIX + slug.replace(/[^a-z0-9-]/g, ''), opts); } catch { return null; }
}
export async function setQueueToken(slug: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(QUEUE_KEY_PREFIX + slug.replace(/[^a-z0-9-]/g, ''), token, opts);
}
