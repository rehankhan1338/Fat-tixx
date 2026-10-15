import Constants from 'expo-constants';

/**
 * Backend origin.
 *
 * - `EXPO_PUBLIC_API_URL`, when set, always wins: the https:// site for release builds, or a tunnel /
 *   staging server during development (see .env.example).
 * - Otherwise, in development, the backend is assumed to run on the same machine as Metro: the host the
 *   app loaded its bundle from (`Constants.expoConfig.hostUri`, e.g. "192.168.11.231:8081") on
 *   `EXPO_PUBLIC_API_PORT` (default 3000). So `npx expo start` works on any Wi-Fi without editing .env.
 */
const fromExtra = Constants.expoConfig?.extra?.apiUrl;
const explicit = (process.env.EXPO_PUBLIC_API_URL ?? (typeof fromExtra === 'string' ? fromExtra : '')).trim();
const port = (process.env.EXPO_PUBLIC_API_PORT ?? '3000').trim();

function fromMetroHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? null;
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:${port}` : null;
}

const raw = (explicit || (__DEV__ ? fromMetroHost() : null) || 'http://localhost:3000').replace(/\/+$/, '');

// Release builds may only talk to the backend over TLS; a plain-http URL would send session tokens in the clear.
// The one exception is the `lan` EAS profile (eas.json): a test APK for a dev machine on the same Wi-Fi.
const allowHttp = process.env.EXPO_PUBLIC_ALLOW_HTTP_API === '1';
if (!__DEV__ && !allowHttp && !/^https:\/\//i.test(raw)) {
  throw new Error('EXPO_PUBLIC_API_URL must be an https:// origin in production builds.');
}

export const API_URL = raw;
export const API_BASE = `${API_URL}/api/mobile/v1`;
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
