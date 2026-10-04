import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fonts, radius, red } from '@/theme/tokens';
import { Txt } from './Text';

type Variant = 'primary' | 'red' | 'outline' | 'ghost' | 'danger';
type Size = 'md' | 'sm' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}

const bg: Record<Variant, string> = { primary: colors.yellow, red: colors.red, outline: 'transparent', ghost: 'transparent', danger: colors.rose };
const fg: Record<Variant, string> = { primary: colors.red, red: colors.ivory, outline: colors.red, ghost: colors.red, danger: colors.pureWhite };
const border: Record<Variant, string> = { primary: 'transparent', red: 'transparent', outline: red(0.3), ghost: 'transparent', danger: 'transparent' };
const heights: Record<Size, number> = { sm: 42, md: 46, lg: 54 };

/** Pill button, the site's `button()` helper: yellow primary, solid red, outlined. */
export function Button({ title, variant = 'primary', size = 'md', loading, icon, style, full, disabled, ...rest }: ButtonProps) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => [
        styles.base, { minHeight: heights[size], backgroundColor: bg[variant], borderColor: border[variant], opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        full ? styles.full : null, style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg[variant]} /> : icon ? <View style={styles.icon}>{icon}</View> : null}
      <Txt style={[styles.label, { color: fg[variant], fontSize: size === 'lg' ? 16 : 15 }]} numberOfLines={1}>{title}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 22, borderRadius: radius.pill, borderWidth: 1 },
  full: { alignSelf: 'stretch' },
  icon: { marginRight: -2 },
  label: { fontFamily: fonts.sansSemi, lineHeight: 20 },
});
