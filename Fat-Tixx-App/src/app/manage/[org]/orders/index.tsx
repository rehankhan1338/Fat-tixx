import { useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useManageOrders } from '@/api/hooks';
import { NavRow } from '@/components/manage/Stats';
import { ErrorState, Screen, Skeleton, StatusBadge, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { colors, fonts, red } from '@/theme/tokens';

/** Order search for an organisation (optionally one event): order code, buyer, attendee name or ticket code. */
export default function OrgOrdersScreen() {
  const { org, eventId } = useLocalSearchParams<{ org: string; eventId?: string }>();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data, isLoading, isError, error, refetch, isRefetching } = useManageOrders(org, debounced, eventId);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(v.trim()), 250);
  }

  return (
    <Screen back title="Orders" scroll={false} padded={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
        <View style={styles.search}>
          <Search size={16} color={red(0.6)} />
          <TextInput value={q} onChangeText={onSearch} placeholder="FTX-XXXXXX, email, name or ticket code" placeholderTextColor={red(0.5)} autoCorrect={false} autoCapitalize="none" style={styles.input} accessibilityLabel="Search orders" />
        </View>
        <Txt variant="caption" style={{ marginTop: 6 }}>{data ? `${data.orders.length} orders${eventId ? ' for this event' : ''}` : ' '}</Txt>
      </View>
      {isLoading ? <View style={{ padding: 20, gap: 10 }}><Skeleton style={{ height: 74 }} /><Skeleton style={{ height: 74 }} /></View>
        : isError ? <View style={{ padding: 20 }}><ErrorState message={(error as Error).message} onRetry={() => refetch()} /></View>
        : (
          <FlatList
            data={data?.orders ?? []}
            keyExtractor={(o) => o.code}
            contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 8 }}
            onRefresh={refetch}
            refreshing={isRefetching}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Txt variant="small" center style={{ marginTop: 30 }}>{debounced ? 'No order matches that search.' : 'No orders yet.'}</Txt>}
            renderItem={({ item: o }) => (
              <NavRow title={`${o.code} · ${o.buyerName ?? o.buyerEmail}`} badge={<StatusBadge status={o.status} />}
                sub={`${o.eventTitle}\n${o.ticketCount} ticket${o.ticketCount === 1 ? '' : 's'} · ${new Date(o.createdAt).toLocaleDateString()}${o.source !== 'online' ? ` · ${o.source.replace('_', ' ')}` : ''}`}
                right={formatCents(o.totalCents - 0, o.currency)}
                onPress={() => router.push({ pathname: '/manage/[org]/orders/[code]', params: { org, code: o.code } })} />
            )}
          />
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink, paddingVertical: 10 },
});
