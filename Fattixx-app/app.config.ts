import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Fat Tixx mobile app (Android + iOS). Native behaviour is configured here and generated at build time
 * (Continuous Native Generation); the ios/ and android/ folders are never edited by hand.
 *
 * API_URL: where the Next.js backend runs. Unset in development, the app uses the machine that runs
 * `npx expo start` (see src/lib/config.ts); set EXPO_PUBLIC_API_URL in `.env` for a fixed backend.
 * Production builds must point at an https:// origin (enforced in src/lib/config.ts).
 */
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? null;
// Plain-http backend (a dev machine on the LAN): Android must be allowed cleartext traffic.
const isDevApi = !apiUrl || /^http:\/\//i.test(apiUrl);

const BRAND_RED = '#A8121A';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Fat Tixx',
  slug: 'fat-tixx',
  owner: 'rehanaltafkhaan',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'fattixx',
  userInterfaceStyle: 'light',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: 'com.fattixx.app',
    supportsTablet: false,
    // Only https:// connections are allowed in release builds (App Transport Security default).
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.fattixx.app',
    adaptiveIcon: {
      backgroundColor: BRAND_RED,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Session tokens live in the Keystore-backed SecureStore; never let them be copied into cloud backups.
    allowBackup: false,
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    // Launch screen: the ticket logo on brand red, like the website's header (Expo Go cannot show it; the
    // in-app src/components/Splash.tsx draws the same screen while the session is restored).
    ['expo-splash-screen', { backgroundColor: BRAND_RED, image: './assets/images/splash-icon.png', imageWidth: 220, resizeMode: 'contain', dark: { backgroundColor: BRAND_RED, image: './assets/images/splash-icon.png' } }],
    ['expo-secure-store', { configureAndroidBackup: false }],
    ['expo-camera', { cameraPermission: 'Fat Tixx uses the camera to scan ticket QR codes at the door.' }],
    ['expo-build-properties', { android: { usesCleartextTraffic: isDevApi }, ios: {} }],
  ],
  extra: { ...(apiUrl ? { apiUrl } : {}), eas: { projectId: 'afc01174-daca-42a8-9eae-4263fd8eecb4' } },
  experiments: { typedRoutes: true, reactCompiler: true },
});
