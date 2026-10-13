import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts, red } from '@/theme/tokens';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'caption' | 'eyebrow' | 'mono';

const variants: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 38, letterSpacing: -1.1, color: colors.red },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, color: colors.red },
  heading: { fontFamily: fonts.display, fontSize: 19, lineHeight: 23, letterSpacing: -0.3, color: colors.red },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: red(0.85) },
  bodyStrong: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 22, color: colors.red },
  small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: red(0.78) },
  caption: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 16, color: red(0.6) },
  eyebrow: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 16, letterSpacing: 1.6, textTransform: 'uppercase', color: red(0.6) },
  mono: { fontFamily: 'monospace', fontSize: 13, lineHeight: 18, letterSpacing: 1, color: red(0.78) },
};

export interface TxtProps extends TextProps { variant?: Variant; color?: string; center?: boolean }

/** Themed text. `variant` picks the website's type scale; `color` overrides the ink. */
export function Txt({ variant = 'body', color, center, style, ...rest }: TxtProps) {
  return <RNText {...rest} style={[variants[variant], color ? { color } : null, center ? styles.center : null, style]} />;
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } });
