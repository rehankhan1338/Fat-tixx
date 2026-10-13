import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useMyOrders } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { listRememberedOrders, type RememberedOrder } from '@/auth/secure';
import { Button, Card, EmptyState, ErrorState, Notice, Screen, SectionLoader, StatusBadge, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { colors, red } from '@/theme/tokens';

/**
 * My tickets: orders on the account (when signed in) plus purchases made on this device as a guest.
 * Guest orders are remembered through their per-order access token in SecureStore.
 */
export default function TicketsScreen() {
  const { status } = useAuth();
  const signedIn = status === 'signed-in';
  const { data, isLoading, isError, error, refetch, isRefetching } = useMyOrders(signedIn);
  const [local, setLocal] = useState<RememberedOrder[]>([]);
  const reload = useCallback(() => { listRememberedOrders().then(setLocal); }, []);
  useFocusEffect(reload);
  useEffect(reload, [reload]);

  const accountCodes = new Set((data?.orders ?? []).map((o) => o.code));
  const extra = local.filter((o) => !accountCodes.has(o.code));
  const open = (code: string, t?: string) => router.push({ pathname: '/orders/[code]', params: t ? { code, t } : { code } });

  return (
    <Screen title="My tickets" refreshing={isRefetching} onRefresh={() => { refetch(); reload(); }}>
      {signedIn && data && !data.emailVerified ? <Notice tone="warning" title="Confirm your email">Tickets bought earlier with this email appear here once the address is confirmed. Check your inbox, or resend the link from Account.</Notice> : null}

      {signedIn ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          {isLoading ? <SectionLoader label="Loading your tickets…" />
            : isError ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
            : data && data.orders.length ? data.orders.map((o) => (
              <Row key={o.code} onPress={() => open(o.code)} title={o.eventTitle} sub={`Order ${o.code} · ${o.ticketCount} ticket${o.ticketCount === 1 ? '' : 's'} · ${formatCents(o.totalCents, o.currency)}`} status={o.status} />
            )) : extra.length === 0 ? <EmptyState title="No orders yet" description="Tickets you buy with this email appear here." action={<Button title="Browse events" onPress={() => router.navigate('/')} />} /> : null}
        </View>
      ) : null}

      {extra.length ? (
        <View style={{ gap: 10, marginTop: 16 }}>
          {signedIn ? <Txt variant="eyebrow">Bought on this device</Txt> : null}
          {extra.map((o) => <Row key={o.code} onPress={() => open(o.code, o.t)} title={o.title} sub={`Order ${o.code}${o.when ? ` · ${o.when}` : ''}`} />)}
        </View>
      ) : null}

      {!signedIn ? (
        <Card flat style={{ marginTop: 18, gap: 12 }}>
          <Txt variant="heading">Find your tickets</Txt>
          <Txt variant="small">Sign in to see every order on your account, or get a link to your tickets by email.</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button title="Sign in" onPress={() => router.push('/login')} />
            <Button title="Email me a link" variant="outline" onPress={() => router.push('/find-tickets')} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ title, sub, status, onPress }: { title: string; sub: string; status?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed ? { opacity: 0.9 } : null]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="bodyStrong" numberOfLines={2}>{title}</Txt>
        <Txt variant="caption">{sub}</Txt>
        {status ? <StatusBadge status={status} /> : null}
      </View>
      <ChevronRight size={18} color={red(0.5)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
});
