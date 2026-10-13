import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, deep, posterVariants, radius } from '@/theme/tokens';
import { Txt } from './Text';

/**
 * Event artwork: the event's photo when it has one, else the generated poster art from the website
 * (six gradient styles picked by position so neighbours differ). `label` is the category chip.
 */
export function Poster({ imageUrl, variant, label, style, ratio = 4 / 3, rounded = radius.lg }: { imageUrl: string | null; variant: number; label?: string; style?: StyleProp<ViewStyle>; ratio?: number; rounded?: number }) {
  const v = posterVariants[((variant % 6) + 6) % 6];
  return (
    <View style={[styles.box, { aspectRatio: ratio, borderRadius: rounded }, style]}>
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" recyclingKey={imageUrl} />
      ) : (
        <LinearGradient colors={[v.bg, 'bg2' in v && v.bg2 ? v.bg2 : v.bg]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill}>
          <Shape shape={v.shape} accent={v.accent} />
        </LinearGradient>
      )}
      <LinearGradient colors={['transparent', deep(0.35)]} start={{ x: 0, y: 0.45 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {label ? (
        <View style={styles.chip}><Txt style={styles.chipText}>{label}</Txt></View>
      ) : null}
    </View>
  );
}

function Shape({ shape, accent }: { shape: string; accent: string }) {
  switch (shape) {
    case 'dot':
    case 'dot-stripes':
      return <View style={[styles.circle, { backgroundColor: accent, right: '12%', top: '18%', width: '46%' }]} />;
    case 'ring':
      return <View style={[styles.circle, styles.ring, { borderColor: accent, right: '18%', top: '16%', width: '42%' }]} />;
    case 'ring-left':
      return <View style={[styles.circle, styles.ring, { borderColor: accent, left: '14%', top: '20%', width: '40%' }]} />;
    case 'glow':
      return <View style={[styles.circle, { backgroundColor: accent, right: '-6%', top: '-10%', width: '70%', opacity: 0.8 }]} />;
    default:
      return <View style={[styles.circle, { backgroundColor: accent, left: '-10%', top: '-20%', width: '80%', opacity: 0.8 }]} />;
  }
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#120C0C', width: '100%' },
  circle: { position: 'absolute', aspectRatio: 1, borderRadius: 999 },
  ring: { borderWidth: 14, backgroundColor: 'transparent' },
  chip: { position: 'absolute', left: 12, bottom: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: deep(0.5), borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  chipText: { fontSize: 11, lineHeight: 14, letterSpacing: 0.4, fontFamily: 'IBMPlexSans_600SemiBold', color: colors.pureWhite },
});
