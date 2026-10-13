import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, red } from '@/theme/tokens';
import { Txt } from './Text';

/**
 * Brand spinner: a faint track ring with a red arc sweeping around it. Replaces the platform
 * ActivityIndicator so loading looks the same on iOS and Android.
 */
export function Spinner({ size = 40, color = colors.red, track = red(0.12), thickness, style }: {
  size?: number; color?: string; track?: string; thickness?: number; style?: StyleProp<ViewStyle>;
}) {
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const stroke = thickness ?? Math.max(2, Math.round(size / 11));
  const ring = { width: size, height: size, borderRadius: size / 2, borderWidth: stroke };
  return (
    <View style={[{ width: size, height: size }, style]} accessibilityRole="progressbar" accessibilityLabel="Loading">
      <View style={[styles.abs, ring, { borderColor: track }]} />
      <Animated.View style={[styles.abs, ring, { borderColor: 'transparent', borderTopColor: color, borderRightColor: color, transform: [{ rotate }] }]} />
    </View>
  );
}

/** Fills its parent and centres the spinner, with an optional caption. Fades in so quick loads never flash. */
export function ScreenLoader({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 260, delay: 120, useNativeDriver: true }).start();
  }, [fade]);
  return (
    <Animated.View style={[styles.full, { opacity: fade }, style]} accessibilityLiveRegion="polite">
      <View style={styles.badge}>
        <Spinner size={44} />
      </View>
      {label ? <Txt variant="small" center style={styles.label}>{label}</Txt> : null}
    </Animated.View>
  );
}

/** A centred spinner for a section of a page (a list below a header), sized so it sits mid-screen. */
export function SectionLoader({ label, height = 260, style }: { label?: string; height?: number; style?: StyleProp<ViewStyle> }) {
  return <ScreenLoader label={label} style={[{ flex: 0, minHeight: height }, style]} />;
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', top: 0, left: 0 },
  full: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pureWhite, shadowColor: colors.red, shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  label: { color: red(0.7) },
});
