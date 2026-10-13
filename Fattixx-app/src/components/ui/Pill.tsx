import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { cardShadow, colors, fonts, radius, red } from '@/theme/tokens';
import { Txt } from './Text';

/** Filter / category pill. Pressed state inverts to solid red, like the site's aria-pressed styling. */
export function Pill({ label, active, onPress, icon, style, shadow }: { label: string; active?: boolean; onPress?: () => void; icon?: React.ReactNode; style?: StyleProp<ViewStyle>; shadow?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [styles.pill, shadow ? cardShadow : null, active ? styles.active : null, pressed ? { opacity: 0.85 } : null, style]}>
      {icon}
      <Txt style={[styles.label, active ? styles.labelActive : null]}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingLeft: 14, paddingRight: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  active: { backgroundColor: colors.red, borderColor: colors.red },
  label: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 18, color: colors.red },
  labelActive: { color: colors.ivory },
});
