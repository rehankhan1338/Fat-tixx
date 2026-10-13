import { StyleSheet, View } from 'react-native';
import { colors, fonts, radius, red } from '@/theme/tokens';
import { statusLabel } from '@/lib/format';
import { Txt } from './Text';

const TONE: Record<string, { fg: string; bg: string }> = {
  paid: { fg: colors.emerald, bg: colors.emeraldBg }, valid: { fg: colors.emerald, bg: colors.emeraldBg }, published: { fg: colors.emerald, bg: colors.emeraldBg }, active: { fg: colors.emerald, bg: colors.emeraldBg },
  pending: { fg: colors.amber, bg: colors.amberBg }, postponed: { fg: colors.amber, bg: colors.amberBg },
  used: { fg: colors.sky, bg: colors.skyBg }, completed: { fg: colors.sky, bg: colors.skyBg },
  cancelled: { fg: colors.rose, bg: colors.roseBg }, refunded: { fg: colors.rose, bg: colors.roseBg }, failed: { fg: colors.rose, bg: colors.roseBg },
  partially_refunded: { fg: '#C2410C', bg: 'rgba(249,115,22,0.15)' },
  expired: { fg: colors.slate, bg: colors.slateBg }, transferred: { fg: colors.slate, bg: colors.slateBg }, draft: { fg: colors.slate, bg: colors.slateBg },
};

/** Status chip (StatusBadge on the website). */
export function StatusBadge({ status }: { status: string }) {
  const t = TONE[status] ?? { fg: colors.slate, bg: colors.slateBg };
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.fg + '55' }]}>
      <Txt style={[styles.text, { color: t.fg }]}>{statusLabel(status)}</Txt>
    </View>
  );
}

/** Small outlined tag, e.g. "Selling fast" or "21+ event". */
export function Tag({ label, tone = 'red' }: { label: string; tone?: 'red' | 'yellow' | 'ivory' }) {
  const fg = tone === 'ivory' ? colors.ivory : colors.red;
  const bg = tone === 'yellow' ? colors.yellow : 'transparent';
  const border = tone === 'ivory' ? 'rgba(245,241,234,0.3)' : red(0.3);
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Txt style={[styles.text, { color: fg, textTransform: 'none', letterSpacing: 0 }]}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1 },
  text: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 16, textTransform: 'capitalize' },
});
