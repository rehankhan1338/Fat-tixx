import { useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAttendees, useEventDetail } from '@/api/hooks';
import type { Attendee, ScanResult } from '@/api/types';
import { Button, ErrorState, Notice, Screen, ScreenLoader, StatusBadge, Txt } from '@/components/ui';
import { colors, fonts, radius, red } from '@/theme/tokens';

/**
 * Door list. Check a guest in by name when their phone is dead, admit a ticket the scanner refused
 * (override), or undo a mistaken scan. All go through the same server actions as the camera scanner, so
 * every change is logged with the staff member's name and the per-member override / undo permissions
 * set by the Organization Admin apply.
 */
export default function AttendeesScreen() {
  const { org, eventId, title } = useLocalSearchParams<{ org: string; eventId: string; title?: string }>();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const { data, isLoading, isError, error, refetch, isRefetching } = useAttendees(org, eventId, debounced);
  const { data: event } = useEventDetail(org, eventId);
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(v.trim()), 250);
  }

  async function act(a: Attendee, action: 'manual' | 'undo' | 'override') {
    const reason = action === 'manual' ? undefined : action === 'undo' ? 'Undone from the app door list' : 'Admitted from the app door list';
    try {
      const r = await api<ScanResult>(`/scan/${org}/${eventId}`, { method: 'POST', body: { action, ticketId: a.ticketId, reason } });
      const good = r.result === 'manual' || r.result === 'override' || r.result === 'undo';
      setMsg({ tone: good ? 'success' : r.result === 'already_used' ? 'warning' : 'error', text: `${a.name ?? a.buyerName ?? a.code}: ${r.message}` });
      await queryClient.invalidateQueries({ queryKey: ['me:event', org, eventId] });
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }
  function confirm(a: Attendee) {
    const who = a.name ?? a.buyerName ?? a.code;
    if (a.status === 'valid') {
      Alert.alert('Check in', `Admit ${who} (${a.ticketType})?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Check in', onPress: () => { void act(a, 'manual'); } }]);
    } else if (a.status === 'used') {
      const buttons = [{ text: 'Cancel', style: 'cancel' as const }];
      if (event?.perms.canUndoCheckin) buttons.push({ text: 'Undo check-in', style: 'destructive' as 'cancel', onPress: () => { void act(a, 'undo'); } } as never);
      Alert.alert('Already checked in', `${who} was admitted${a.checkedInAt ? ` at ${new Date(a.checkedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}${a.checkedInBy ? ` by ${a.checkedInBy}` : ''}.`, buttons);
    } else if (event?.perms.canOverrideCheckin) {
      Alert.alert('Ticket is ' + a.status, `Admit ${who} anyway? This is logged as an override.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Override', style: 'destructive', onPress: () => { void act(a, 'override'); } }]);
    } else {
      Alert.alert('Ticket is ' + a.status, 'This ticket cannot be admitted. Ask an organizer to override.');
    }
  }

  return (
    <Screen back title={title ?? 'Attendees'} scroll={false} padded={false}>
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Search size={16} color={red(0.6)} />
          <TextInput value={q} onChangeText={onSearch} placeholder="Name, email, ticket or order code" placeholderTextColor={red(0.5)} autoCorrect={false} autoCapitalize="none" style={styles.input} accessibilityLabel="Search attendees" />
        </View>
        <Txt variant="caption" style={{ marginTop: 6 }}>{data ? `${data.attendees.length} shown · ${data.total} tickets${event ? ` · ${event.counts.used} checked in` : ''}` : ' '}</Txt>
        {msg ? <View style={{ marginTop: 8 }}><Notice tone={msg.tone}>{msg.text}</Notice></View> : null}
      </View>
      {isLoading ? <ScreenLoader label="Loading attendees…" />
        : isError ? <View style={{ padding: 20 }}><ErrorState message={(error as Error).message} onRetry={() => refetch()} /></View>
        : (
          <FlatList
            data={data?.attendees ?? []}
            keyExtractor={(a) => String(a.ticketId)}
            contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 8 }}
            onRefresh={refetch}
            refreshing={isRefetching}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Txt variant="small" center style={{ marginTop: 30 }}>{debounced ? 'No attendee matches that search.' : 'No tickets issued yet.'}</Txt>}
            renderItem={({ item: a }) => (
              <View style={[styles.row, a.status !== 'valid' && a.status !== 'used' ? { opacity: 0.6 } : null]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>{a.name ?? a.buyerName ?? '—'}{a.transferred ? ' (transferred)' : ''}</Txt>
                  <Txt variant="caption" numberOfLines={1}>{a.ticketType}{a.dayLabel ? ` · ${a.dayLabel}` : ''}{a.seatLabel ? ` · ${a.seatLabel}` : ''} · {a.code}</Txt>
                  <Txt variant="caption" numberOfLines={1}>{a.email ?? a.buyerEmail} · order {a.orderCode}{a.addons ? ` · ${a.addons}` : ''}</Txt>
                  {a.status === 'used' && a.checkedInAt ? <Txt variant="caption" color={colors.sky}>In at {new Date(a.checkedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{a.checkedInBy ? ` · ${a.checkedInBy}` : ''}</Txt> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <StatusBadge status={a.status} />
                  <Button title={a.status === 'valid' ? 'Check in' : a.status === 'used' ? 'Details' : 'Review'} size="sm" variant={a.status === 'valid' ? 'primary' : 'ghost'} onPress={() => confirm(a)} />
                </View>
              </View>
            )}
          />
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 20, paddingTop: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
});
