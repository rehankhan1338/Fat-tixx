import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { api } from '@/api/client';

/**
 * Push notifications (server side: Fattixx-web/src/lib/push.ts).
 *
 * After sign-in the app asks for permission once, gets this install's Expo push token and sends it to
 * POST /devices, which ties it to the current session. Signing out ends the session on the server, so
 * the phone stops getting alerts. The person can switch alerts off on the Account tab (DELETE /devices).
 */
const ENABLED_KEY = 'fx.push.enabled';   // '0' when switched off in the app; anything else = on
const TOKEN_KEY = 'fx.push.token';       // last token sent to the server, to unregister it later

// Show alerts while the app is open too (a door scanner is usually in the foreground).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported';

async function readPref(): Promise<boolean> {
  try { return (await SecureStore.getItemAsync(ENABLED_KEY)) !== '0'; } catch { return true; }
}
async function writePref(on: boolean): Promise<void> {
  try { await SecureStore.setItemAsync(ENABLED_KEY, on ? '1' : '0'); } catch { /* keep going */ }
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Android 8+: alerts need a channel; the name shows in the phone's notification settings.
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Event alerts',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#A8121A',
  });
}

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Send a token to the server for this session. */
export async function sendToken(token: string): Promise<void> {
  await api('/devices', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  try { await SecureStore.setItemAsync(TOKEN_KEY, token); } catch { /* fine */ }
}

/**
 * Register this phone for the signed-in session. `ask`: show the system permission prompt if it has not been
 * answered yet. Returns the resulting state; never throws.
 */
export async function registerForPush(ask: boolean): Promise<PushState> {
  try {
    if (!Device.isDevice || Platform.OS === 'web') return 'unsupported';
    if (!(await readPref())) return 'off';
    await ensureChannel();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain && ask) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return perm.canAskAgain ? 'off' : 'blocked';
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    await sendToken(token);
    return 'on';
  } catch {
    // Offline, or a build without push support (Expo Go): try again next launch.
    return 'off';
  }
}

/** The Account tab switch. */
export async function setPushEnabled(on: boolean): Promise<PushState> {
  await writePref(on);
  if (on) return registerForPush(true);
  let token: string | null = null;
  try { token = await SecureStore.getItemAsync(TOKEN_KEY); } catch { /* none */ }
  await api('/devices', { method: 'DELETE', body: token ? { token } : {} }).catch(() => {});
  return 'off';
}

/** What the Account tab shows, without prompting. */
export async function currentPushState(): Promise<PushState> {
  if (!Device.isDevice || Platform.OS === 'web') return 'unsupported';
  if (!(await readPref())) return 'off';
  try {
    const perm = await Notifications.getPermissionsAsync();
    return perm.granted ? 'on' : perm.canAskAgain ? 'off' : 'blocked';
  } catch {
    return 'unsupported';
  }
}

/** Ask the server for a test alert to this person's phones. */
export async function sendTestPush(): Promise<void> {
  await api('/devices/test', { method: 'POST' });
}

/** Only app routes the server is known to send (see Fattixx-web/src/lib/push.ts); anything else is ignored. */
export function routeFromNotification(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return null;
  return /^\/event\/[a-z0-9-]{1,120}\/\d{1,12}$/.test(url) || url === '/account' ? url : null;
}
