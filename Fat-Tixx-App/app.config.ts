import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Fat Tixx mobile app (Android + iOS). Native behaviour is configured here and generated at build time
 * (Continuous Native Generation); the ios/ and android/ folders are never edited by hand.
 *
 * API_URL: where the Next.js backend runs. Set EXPO_PUBLIC_API_URL in `.env` (see .env.example).
 * During development on a phone this is your PC's LAN address, e.g. http://192.168.1.22:3000.
 * Production builds must point at an https:// origin (enforced in src/lib/config.ts).
 */
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const isDevApi = /^http:\/\//i.test(apiUrl);

const BRAND_RED = '#A8121A';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Fat Tixx',
  slug: 'fat-tixx',
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
    ['expo-splash-screen', { backgroundColor: BRAND_RED, image: './assets/images/splash-icon.png', imageWidth: 120 }],
    ['expo-secure-store', { configureAndroidBackup: false }],
    ['expo-camera', { cameraPermission: 'Fat Tixx uses the camera to scan ticket QR codes at the door.' }],
    ['@stripe/stripe-react-native', { merchantIdentifier: 'merchant.com.fattixx.app', enableGooglePay: true }],
    ['expo-build-properties', { android: { usesCleartextTraffic: isDevApi }, ios: {} }],
  ],
  extra: { apiUrl },
  experiments: { typedRoutes: true, reactCompiler: true },
});
