import { StyleSheet, View, type ViewProps } from 'react-native';
import { cardShadow, colors, radius, red } from '@/theme/tokens';

/** White rounded panel with the site's soft red shadow. */
export function Card({ style, flat, ...rest }: ViewProps & { flat?: boolean }) {
  return <View {...rest} style={[styles.card, flat ? null : cardShadow, style]} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.pureWhite, borderRadius: radius.xl, borderWidth: 1, borderColor: red(0.1), padding: 16 },
});
