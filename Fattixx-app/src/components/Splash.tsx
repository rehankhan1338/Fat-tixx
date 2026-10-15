import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Logo } from '@/components/Logo';
import { colors } from '@/theme/tokens';

/**
 * In-app splash: the same brand-red screen with the ticket logo that the native splash shows
 * (app.config.ts), plus a loading spinner in the brand yellow while fonts load and the stored session
 * is checked. Once it has drawn it takes over from the native splash (which cannot animate), so there
 * is no visual jump. It also gives Expo Go, which cannot show the native one, the branded launch screen.
 */
export function Splash() {
  const { width, height: screenHeight } = useWindowDimensions();
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 320, delay: 150, useNativeDriver: true }).start();
  }, [fade]);
  // Same proportion as the native splash: the logo takes a little over half the screen width.
  const logoHeight = Math.round(Math.min(width * 0.56, 260) / (600 / 385));
  return (
    // The screen and logo are drawn at full opacity so the hand-over from the native splash is seamless;
    // only the spinner fades in. It sits below the centred logo so the logo stays where the native one was.
    <View style={styles.fill} onLayout={() => SplashScreen.hideAsync().catch(() => {})}>
      <StatusBar style="light" />
      <Logo height={logoHeight} />
      <Animated.View style={[styles.spinner, { top: screenHeight / 2 + logoHeight / 2 + 40, opacity: fade }]}>
        <ActivityIndicator size="large" color={colors.yellow} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red },
  spinner: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
