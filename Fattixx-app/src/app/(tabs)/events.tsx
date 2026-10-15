import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { ChevronRight, CloudOff, Ticket } from 'lucide-react-native';
import { useScanEvents } from '@/api/hooks';
import type { ScanEvent } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Chips } from '@/components/Stats';
import { EmptyState, ErrorState, Screen, SectionLoader, Tag, Txt } from '@/components/ui';
import { hasAppAccess } from '@/lib/access';
import { offlineStatus, rememberScanEvents, rememberedScanEvents, type OfflineStatus } from '@/scanner/store';
import { colors, red } from '@/theme/tokens';

/**
 * The events the signed-in member may work: every event of the organisation for an Organization Admin,
 * only assigned events for organizers and staff (server-enforced). Each opens the event's check-in screen.
 * The last upcoming list fetched is kept on the phone, so the picker still opens at a venue with no signal;
 * events whose ticket list is downloaded are marked "Offline ready" and can be scanned without a connection.
 */
export default function EventsScreen() {
  const { status, account } = useAuth();
  const enabled = status === 'signed-in' && hasAppAccess(account);
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming');
  const upcoming = filter === 'upcoming';
  const { data, isLoading, isError, error, refetch, isRefetching } = useScanEvents(enabled, filter);
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const [stored, setStored] = useState<ScanEvent[] | null>(null);
  const [ready, setReady] = useState<OfflineStatus>({});

  // Remember the server's upcoming list for offline launches; fall back to the remembered copy when it cannot be fetched.
  useEffect(() => {
    if (upcoming && data?.events) void rememberScanEvents(data.events);
  }, [data, upcoming]);
  useEffect(() => {
    if (!enabled || data || !upcoming) return;
    let on = true;
    rememberedScanEvents<ScanEvent>().then((list) => { if (on && list.length) setStored(list); });
    return () => { on = false; };
  }, [enabled, data, upcoming]);

  useFocusEffect(useCallback(() => {
    let on = true;
    offlineStatus().then((s) => { if (on) setReady(s); }).catch(() => {});
    return () => { on = false; };
  }, []));

  const events = data?.events ?? (upcoming ? stored : null);
  const usingStored = !data && !!stored && upcoming;
  const orgCount = new Set((events ?? []).map((e) => e.orgSlug)).size;

  return (
    <Screen title="Events" refreshing={isRefetching} onRefresh={refetch}>
      <Txt variant="small" style={{ marginBottom: 12 }}>Choose the event you are working. Every scan and check-in is recorded with your name.</Txt>
      <Chips value={filter} onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'Past', value: 'past' }]} />
      {offline || usingStored ? (
        <View style={styles.offlineNote}>
          <CloudOff size={16} color={colors.red} />
          <Txt variant="caption" style={{ flex: 1 }}>{offline ? 'No connection. Events marked "Offline ready" can still be scanned; check-ins upload when you are back online.' : 'Showing the last list loaded on this phone.'}</Txt>
        </View>
      ) : null}
      <View style={{ gap: 10, marginTop: 14 }}>
        {isLoading && !events ? <SectionLoader label="Loading your events…" />
          : isError && !events ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          : !events?.length ? <EmptyState title={upcoming ? 'No upcoming events' : 'No past events'} description={upcoming ? 'Events you may work appear here once they are published. Organizers assign staff to events on the website.' : 'Events that have already taken place will be listed here.'} />
          : events.map((e) => {
            const r = ready[e.eventId];
            return (
              <Pressable key={`${e.orgSlug}-${e.eventId}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/event/[org]/[eventId]', params: { org: e.orgSlug, eventId: String(e.eventId), title: e.title } })}
                style={({ pressed }) => [styles.row, pressed ? { opacity: 0.9 } : null]}>
                <View style={styles.icon}><Ticket size={20} color={colors.red} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={2}>{e.title}</Txt>
                  <Txt variant="caption">{e.when}{e.venue ? ` · ${e.venue}` : ''}</Txt>
                  <Txt variant="caption">{orgCount > 1 ? `${e.orgName} · ` : ''}{roleLabel(e.role)} · {e.counts.used}/{e.counts.total} checked in</Txt>
                  {r?.downloaded || r?.queued ? (
                    <View style={styles.tags}>
                      {r.downloaded ? <Tag label="Offline ready" /> : null}
                      {r.queued ? <Tag label={`${r.queued} to upload`} tone="yellow" /> : null}
                    </View>
                  ) : null}
                </View>
                <ChevronRight size={18} color={red(0.5)} />
              </Pressable>
            );
          })}
      </View>
    </Screen>
  );
}

function roleLabel(role: string): string {
  return role === 'org_admin' ? 'Organization admin' : role === 'organizer' ? 'Organizer' : role === 'staff' ? 'Staff' : role.replace(/_/g, ' ');
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  offlineNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.sand, marginTop: 12 },
});
