import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { Splash } from '@/components/Splash';
import { TopProgress } from '@/components/TopProgress';
import { colors } from '@/theme/tokens';

// The native splash (brand red with the ticket logo) stays up until the in-app <Splash /> (same screen plus a
// loading spinner) has drawn; that one stays until fonts are in and the stored session is checked.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * React Query: one retry, data kept 10 min so back-navigation is instant. Errors are shown per screen.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, gcTime: 10 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: true } },
});

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.red, background: colors.ivory, card: colors.pureWhite, text: colors.red, border: 'rgba(168,18,26,0.12)' } };

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The app has two worlds and nothing public: signed out there is only the sign-in screen (and password
 * reset); signed in there are the events and the check-in screens. `Stack.Protected` keeps each side
 * unreachable from the other, and when the session ends on a signed-in screen the router drops back to
 * "/", which redirects to sign-in. Nothing here links to the website: the organiser dashboard, admin
 * console, analytics, marketing, orders and the like stay on the web.
 */
function Gate() {
  const { status } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
  });
  const ready = (fontsLoaded || !!fontError) && status !== 'loading';
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return <Splash />;

  const signedIn = status === 'signed-in';
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ivory }, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
          <Stack.Screen name="forgot" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="event/[org]/[eventId]/index" />
          <Stack.Screen name="event/[org]/[eventId]/attendees" />
          <Stack.Screen name="scan/[org]/[eventId]" />
        </Stack.Protected>
      </Stack>
      <TopProgress />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
