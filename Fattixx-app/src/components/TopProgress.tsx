import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { useManualBusy } from '@/lib/loading';
import { colors } from '@/theme/tokens';

const HEIGHT = 3;
const SHOW_DELAY = 150;

/**
 * Thin progress bar pinned under the status bar, like a browser's page-load bar. It runs while any
 * request, mutation, session restore or manual busy signal is active: it jumps ahead quickly, trickles
 * toward the end, then completes and fades out once everything has settled.
 */
export function TopProgress() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const manual = useManualBusy();
  const { status } = useAuth();
  const active = fetching > 0 || mutating > 0 || manual || status === 'loading';

  const [progress] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (active) {
      // Wait a moment so cached or near-instant loads never flash the bar.
      timer = setTimeout(() => {
        shown.current = true;
        running.current?.stop();
        progress.setValue(0);
        opacity.setValue(1);
        running.current = Animated.sequence([
          Animated.timing(progress, { toValue: 0.62, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(progress, { toValue: 0.9, duration: 7000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]);
        running.current.start();
      }, SHOW_DELAY);
    } else if (shown.current) {
      shown.current = false;
      running.current?.stop();
      running.current = Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 260, delay: 60, useNativeDriver: true }),
      ]);
      running.current.start(({ finished }) => { if (finished) progress.setValue(0); });
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [active, progress, opacity]);

  // scaleX shrinks around the centre, so shift the bar left by half the hidden width to anchor it at the edge.
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0] });
  const headX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  return (
    <Animated.View pointerEvents="none" style={[styles.track, { top: insets.top, width, opacity }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.bar, { width, transform: [{ translateX }, { scaleX: progress }] }]}>
        <LinearGradient colors={[colors.red, colors.redBright, colors.yellow]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} locations={[0, 0.82, 1]} style={styles.fill} />
      </Animated.View>
      <Animated.View style={[styles.glow, { transform: [{ translateX: headX }] }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'absolute', left: 0, height: HEIGHT, zIndex: 1000, elevation: 1000, overflow: 'hidden' },
  bar: { height: HEIGHT },
  fill: { flex: 1 },
  glow: { position: 'absolute', right: 0, top: 0, width: 60, height: HEIGHT, backgroundColor: colors.yellow, shadowColor: colors.yellow, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, opacity: 0.9 },
});
