import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Brightness from 'expo-brightness';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOrder } from '@/api/hooks';
import { rememberedOrderToken } from '@/auth/secure';
import { TicketQr } from '@/components/TicketQr';
import { ErrorState, StatusBadge, Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/theme/tokens';

/** Full-screen ticket for the door (the website's /t/[code]). Screen brightness goes up while it is open. */
export default function TicketScreen() {
  const { code, order: orderCode, t: tParam } = useLocalSearchParams<{ code: string; order: string; t?: string }>();
  const [t, setT] = useState<string | null | undefined>(tParam ?? undefined);
  useEffect(() => { if (!tParam) rememberedOrderToken(orderCode).then(setT); }, [orderCode, tParam]);
  const { data: order, isError, error, refetch } = useOrder(t === undefined ? undefined : orderCode, t);
  const { width } = useWindowDimensions();

  useEffect(() => {
    let previous: number | null = null;
    Brightness.getBrightnessAsync().then((b) => { previous = b; return Brightness.setBrightnessAsync(1); }).catch(() => {});
    return () => { if (previous != null) Brightness.setBrightnessAsync(previous).catch(() => {}); };
  }, []);

  const ticket = order?.tickets.find((x) => x.code === code);
  return (
    <SafeAreaView style={styles.screen}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} hitSlop={12} style={styles.close}><X size={22} color="#fff" /></Pressable>
      {isError ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} /> : !order || !ticket ? null : (
        <View style={styles.card}>
          <View style={styles.head}>
            <Txt style={styles.brand}>Fat Tixx · {order.event.organizer}</Txt>
            <Txt style={styles.title}>{order.event.title}</Txt>
            <Txt style={styles.sub}>{order.event.when}</Txt>
            {order.event.venue ? <Txt style={styles.sub}>{order.event.venue}</Txt> : null}
          </View>
          <View style={styles.body}>
            {ticket.qr ? <TicketQr payload={ticket.qr} size={Math.min(width - 120, 300)} code={ticket.code} /> : <Txt variant="heading" center color={colors.redBright} style={{ paddingVertical: 40 }}>This ticket is {ticket.status}.</Txt>}
            <View style={styles.details}>
              <Txt style={styles.k}>Ticket</Txt><Txt style={styles.v}>{ticket.type}{ticket.dayLabel ? ` · ${ticket.dayLabel}` : ''}{ticket.seatLabel ? ` · ${ticket.seatLabel}` : ''}</Txt>
              <Txt style={[styles.k, { marginTop: 8 }]}>Attendee</Txt><Txt style={styles.v}>{ticket.attendeeName ?? order.buyerName ?? '—'}</Txt>
              <Txt style={[styles.k, { marginTop: 8 }]}>Order</Txt><Txt style={[styles.v, { fontFamily: 'monospace' }]}>{order.code}</Txt>
              {order.event.ageRestriction ? <View style={styles.age}><Txt style={styles.ageText}>{order.event.ageRestriction}+ event — photo ID required</Txt></View> : null}
            </View>
          </View>
          <View style={styles.foot}><Txt style={styles.footText}>Status</Txt><StatusBadge status={ticket.status} /></View>
        </View>
      )}
      <Txt style={styles.hint}>Screen brightness up. One scan per ticket.</Txt>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#18181B', alignItems: 'center', justifyContent: 'center', padding: 20 },
  close: { position: 'absolute', top: 54, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  card: { width: '100%', maxWidth: 380, borderRadius: 28, overflow: 'hidden', backgroundColor: colors.pureWhite },
  head: { backgroundColor: '#18181B', padding: 20, gap: 3 },
  brand: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: '#FBBF24' },
  title: { fontFamily: fonts.displayBold, fontSize: 21, lineHeight: 25, color: '#fff', marginTop: 4 },
  sub: { fontFamily: fonts.sans, fontSize: 13, color: '#D4D4D8' },
  body: { padding: 20, gap: 16 },
  details: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D4D4D8', paddingTop: 14 },
  k: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#71717A' },
  v: { fontFamily: fonts.sansSemi, fontSize: 15, color: '#18181B' },
  age: { marginTop: 12, backgroundColor: '#FEF3C7', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  ageText: { fontFamily: fonts.sansSemi, fontSize: 12, color: '#78350F' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F4F4F5', paddingHorizontal: 20, paddingVertical: 12 },
  footText: { fontFamily: fonts.sans, fontSize: 12, color: '#71717A' },
  hint: { marginTop: 18, fontFamily: fonts.sans, fontSize: 12, color: '#A1A1AA' },
});
