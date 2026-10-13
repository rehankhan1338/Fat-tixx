import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { colors, radius } from '@/theme/tokens';
import { Txt } from '@/components/ui';

/**
 * Signed ticket QR, drawn locally from the payload the server returned (so it works offline once loaded).
 * Error correction M and a quiet zone match the website's image so the same scanners read both.
 */
export function TicketQr({ payload, size = 200, code }: { payload: string; size?: number; code?: string }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.box, { padding: Math.round(size * 0.06) }]}>
        <QRCode value={payload} size={size} ecl="M" color="#000" backgroundColor="#fff" quietZone={0} />
      </View>
      {code ? <Txt variant="mono" center style={{ marginTop: 8 }}>{code}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  box: { backgroundColor: colors.pureWhite, borderRadius: radius.lg },
});
