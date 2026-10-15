import * as SecureStore from 'expo-secure-store';

/**
 * The session token goes through the OS keychain (iOS) / Keystore-backed storage (Android). Nothing
 * sensitive is ever written to AsyncStorage, logs or the file system.
 */
const SESSION_KEY = 'fx.session.token';

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
