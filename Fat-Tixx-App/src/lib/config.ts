import Constants from 'expo-constants';

/** Backend origin. Comes from EXPO_PUBLIC_API_URL (see .env.example) via app.config.ts. */
const raw = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000').trim().replace(/\/+$/, '');

// Release builds may only talk to the backend over TLS; a plain-http URL would send session tokens in the clear.
if (!__DEV__ && !/^https:\/\//i.test(raw)) {
  throw new Error('EXPO_PUBLIC_API_URL must be an https:// origin in production builds.');
}

export const API_URL = raw;
export const API_BASE = `${API_URL}/api/mobile/v1`;
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
