import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius, red } from '@/theme/tokens';
import { Button } from './Button';
import { Txt } from './Text';

/** Shimmering placeholder block while data loads. */
export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.skeleton, { opacity: pulse }, style]} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Txt variant="bodyStrong" center>Something went wrong</Txt>
      <Txt variant="small" center style={{ marginTop: 4 }}>{message}</Txt>
      {onRetry ? <Button title="Try again" variant="outline" size="sm" onPress={onRetry} style={{ marginTop: 14 }} /> : null}
    </View>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.box}>
      <Txt variant="bodyStrong" center>{title}</Txt>
      {description ? <Txt variant="small" center style={{ marginTop: 4 }}>{description}</Txt> : null}
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  );
}

/** Inline notice: info (ivory), success (green), warning (amber) or error (red). */
export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'error'; title?: string; children?: React.ReactNode }) {
  const palette = {
    info: { bg: colors.pureWhite, border: red(0.14), fg: colors.red },
    success: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)', fg: colors.emerald },
    warning: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.4)', fg: colors.amber },
    error: { bg: 'rgba(224,36,27,0.07)', border: 'rgba(224,36,27,0.4)', fg: colors.redBright },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]} accessibilityLiveRegion="polite">
      {title ? <Txt variant="bodyStrong" color={palette.fg}>{title}</Txt> : null}
      {typeof children === 'string' ? <Txt variant="small" color={palette.fg}>{children}</Txt> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: red(0.08), borderRadius: radius.md },
  box: { alignItems: 'center', padding: 28, borderRadius: radius.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: red(0.2) },
  notice: { gap: 2, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
});
