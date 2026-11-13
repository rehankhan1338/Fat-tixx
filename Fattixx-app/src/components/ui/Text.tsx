import { Platform, Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts, red } from '@/theme/tokens';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'small' | 'caption' | 'eyebrow' | 'mono';

/** iOS has no font named "monospace"; Menlo is its built-in fixed-width face. */
export const monoFont = Platform.select({ ios: 'Menlo', default: 'monospace' });

const variants: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 38, letterSpacing: -1.1, color: colors.red },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, color: colors.red },
  heading: { fontFamily: fonts.display, fontSize: 19, lineHeight: 23, letterSpacing: -0.3, color: colors.red },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: red(0.85) },
  bodyStrong: { fontFamily: fonts.sansSemi, fontSize: 15, lineHeight: 22, color: colors.red },
  small: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18, color: red(0.78) },
  caption: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 16, color: red(0.6) },
  eyebrow: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 16, letterSpacing: 1.6, textTransform: 'uppercase', color: red(0.6) },
  mono: { fontFamily: monoFont, fontSize: 13, lineHeight: 18, letterSpacing: 1, color: red(0.78) },
};

export interface TxtProps extends TextProps { variant?: Variant; color?: string; center?: boolean }

/**
 * Themed text. `variant` picks the website's type scale; `color` overrides the ink.
 * A `style` that changes fontSize without its own lineHeight would keep the variant's line height, and iOS
 * clips glyphs taller than their line, so the line height is scaled to the new size instead.
 */
export function Txt({ variant = 'body', color, center, style, ...rest }: TxtProps) {
  const own = StyleSheet.flatten(style) as TextStyle | undefined;
  const fit = own?.fontSize != null && own.lineHeight == null ? { lineHeight: Math.ceil(own.fontSize * 1.3) } : null;
  return <RNText {...rest} style={[variants[variant], color ? { color } : null, center ? styles.center : null, style, fit]} />;
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } });
