import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Txt } from '@/components/ui';
import { colors, fonts, radius, red } from '@/theme/tokens';

/** Grid of small stat tiles (the website's <Stat/> cards). */
export function StatGrid({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <View style={styles.grid}>
      {items.map((s) => (
        <View key={s.label} style={styles.tile}>
          <Txt variant="caption">{s.label}</Txt>
          <Txt style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Txt>
          {s.hint ? <Txt variant="caption" numberOfLines={1}>{s.hint}</Txt> : null}
        </View>
      ))}
    </View>
  );
}

/** Tappable row used for lists of events, orders, organisations and web links. */
export function NavRow({ title, sub, right, onPress, icon, badge }: { title: string; sub?: string; right?: string | React.ReactNode; onPress: () => void; icon?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed ? { opacity: 0.9 } : null]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt variant="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>{title}</Txt>{badge}</View>
        {sub ? <Txt variant="caption" numberOfLines={2}>{sub}</Txt> : null}
      </View>
      {typeof right === 'string' ? <Txt variant="small" style={{ fontFamily: fonts.sansSemi, color: colors.red }}>{right}</Txt> : right}
      <ChevronRight size={18} color={red(0.5)} />
    </Pressable>
  );
}

/** Horizontal chip row for filters. */
export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { label: string; value: T }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.chip, on ? styles.chipOn : null]}><Txt variant="small" style={{ fontFamily: fonts.sansMedium, color: on ? colors.ivory : colors.red }}>{o.label}</Txt></Pressable>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', gap: 2, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
  value: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, color: colors.red },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: red(0.2), backgroundColor: colors.pureWhite },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
});
