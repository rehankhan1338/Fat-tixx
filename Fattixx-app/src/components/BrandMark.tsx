import { StyleSheet, View } from 'react-native';
import { colors, fonts, radius } from '@/theme/tokens';
import { Txt } from '@/components/ui';

/** "FATTIXX" wordmark (the site's nav) or the initials block used on the panel pages. */
export function Wordmark({ color = colors.ivory, size = 20 }: { color?: string; size?: number }) {
  return <Txt style={{ fontFamily: fonts.displayBlack, fontSize: size, lineHeight: size + 4, letterSpacing: -0.5, color }}>FATTIXX</Txt>;
}

export function BrandBlock({ size = 40 }: { size?: number }) {
  return (
    <View style={[styles.block, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Txt style={{ fontFamily: fonts.displayBlack, fontSize: size * 0.42, color: colors.red }}>FT</Txt>
    </View>
  );
}

const styles = StyleSheet.create({ block: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.yellow, borderRadius: radius.md } });
