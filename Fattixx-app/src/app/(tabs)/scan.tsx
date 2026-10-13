import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { ChevronRight, CloudOff, ScanLine } from 'lucide-react-native';
import { useScanEvents } from '@/api/hooks';
import type { ScanEvent } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, EmptyState, ErrorState, Screen, SectionLoader, Tag, Txt } from '@/components/ui';
import { offlineStatus, rememberScanEvents, rememberedScanEvents, type OfflineStatus } from '@/scanner/store';
import { colors, red } from '@/theme/tokens';

/**
 * Door staff: pick the event to scan for. Only events the member may see are listed (server-enforced).
 * The last list fetched is kept on the phone, so the picker still opens at a venue with no signal; events
 * whose ticket list is downloaded are marked "Offline ready" and can be scanned without a connection.
 */
export default function ScanHomeScreen() {
  const { status, account } = useAuth();
  const enabled = status === 'signed-in' && !!account?.canScan;
  const { data, isLoading, isError, error, refetch, isRefetching } = useScanEvents(enabled);
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const [stored, setStored] = useState<ScanEvent[] | null>(null);
  const [ready, setReady] = useState<OfflineStatus>({});

  // Remember the server's list for offline launches; fall back to the remembered copy when it cannot be fetched.
  useEffect(() => {
    if (data?.events) void rememberScanEvents(data.events);
  }, [data]);
  useEffect(() => {
    if (!enabled || data) return;
    let on = true;
    rememberedScanEvents<ScanEvent>().then((list) => { if (on && list.length) setStored(list); });
    return () => { on = false; };
  }, [enabled, data]);

  useFocusEffect(useCallback(() => {
    let on = true;
    offlineStatus().then((s) => { if (on) setReady(s); }).catch(() => {});
    return () => { on = false; };
  }, []));

  if (status !== 'signed-in') {
    return <Screen title="Scan tickets"><EmptyState title="Sign in to scan" description="Door scanning is for organizers and their staff." action={<Button title="Sign in" onPress={() => router.push('/login')} />} /></Screen>;
  }
  const events = data?.events ?? stored;
  const usingStored = !data && !!stored;
  return (
    <Screen title="Scan tickets" refreshing={isRefetching} onRefresh={refetch}>
      <Txt variant="small" style={{ marginBottom: 12 }}>Choose the event you are working. Every scan is recorded with your name. Open an event once while online and its ticket list is saved on this phone, so scanning keeps working if the signal drops.</Txt>
      {offline || usingStored ? (
        <View style={styles.offlineNote}>
          <CloudOff size={16} color={colors.red} />
          <Txt variant="caption" style={{ flex: 1 }}>{offline ? 'No connection. Events marked "Offline ready" can still be scanned; check-ins upload when you are back online.' : 'Showing the last list loaded on this phone.'}</Txt>
        </View>
      ) : null}
      {isLoading && !events ? <SectionLoader label="Loading your events…" />
        : isError && !events ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        : !events?.length ? <EmptyState title="No upcoming events to scan" description="Events you are assigned to appear here once they are published." />
        : (
          <View style={{ gap: 10 }}>
            {events.map((e) => {
              const r = ready[e.eventId];
              return (
                <Pressable key={`${e.orgSlug}-${e.eventId}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/scan/[org]/[eventId]', params: { org: e.orgSlug, eventId: String(e.eventId), title: e.title } })}
                  style={({ pressed }) => [styles.row, pressed ? { opacity: 0.9 } : null]}>
                  <View style={styles.icon}><ScanLine size={20} color={colors.red} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" numberOfLines={2}>{e.title}</Txt>
                    <Txt variant="caption">{e.when}{e.venue ? ` · ${e.venue}` : ''}</Txt>
                    <Txt variant="caption">{e.orgName} · {e.counts.used}/{e.counts.total} checked in</Txt>
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
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  offlineNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.sand, marginBottom: 12 },
});
