import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StripeProvider } from '@stripe/stripe-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '@/auth/AuthProvider';
import { useConfig } from '@/api/hooks';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * React Query: one retry, data kept 10 min so back-navigation is instant. Errors are shown per screen.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, gcTime: 10 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: true } },
});

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.red, background: colors.ivory, card: colors.pureWhite, text: colors.red, border: 'rgba(168,18,26,0.12)' } };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
  });
  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return <View style={styles.splash} />;
  return (
    <GestureHandlerRootView style={styles.fill}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Providers />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** Stripe needs the platform's publishable key; until the config has loaded the provider stays idle (empty key). */
function Providers() {
  const { data: config } = useConfig();
  return (
    <StripeProvider publishableKey={config?.stripe?.publishableKey ?? ''} merchantIdentifier="merchant.com.fattixx.app" urlScheme="fattixx">
      <ThemeProvider value={theme}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ivory }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="register" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="forgot" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="find-tickets" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="web" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ticket/[code]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        </Stack>
      </ThemeProvider>
    </StripeProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 }, splash: { flex: 1, backgroundColor: colors.red } });
