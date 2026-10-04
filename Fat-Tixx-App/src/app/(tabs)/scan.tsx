import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, ScanLine } from 'lucide-react-native';
import { useScanEvents } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Button, EmptyState, ErrorState, Screen, Skeleton, Txt } from '@/components/ui';
import { colors, red } from '@/theme/tokens';

/** Door staff: pick the event to scan for. Only events the member may see are listed (server-enforced). */
export default function ScanHomeScreen() {
  const { status, account } = useAuth();
  const enabled = status === 'signed-in' && !!account?.canScan;
  const { data, isLoading, isError, error, refetch, isRefetching } = useScanEvents(enabled);

  if (status !== 'signed-in') {
    return <Screen title="Scan tickets"><EmptyState title="Sign in to scan" description="Door scanning is for organizers and their staff." action={<Button title="Sign in" onPress={() => router.push('/login')} />} /></Screen>;
  }
  return (
    <Screen title="Scan tickets" refreshing={isRefetching} onRefresh={refetch}>
      <Txt variant="small" style={{ marginBottom: 12 }}>Choose the event you are working. Every scan is recorded with your name.</Txt>
      {isLoading ? <View style={{ gap: 10 }}><Skeleton style={{ height: 88 }} /><Skeleton style={{ height: 88 }} /></View>
        : isError ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        : !data?.events.length ? <EmptyState title="No upcoming events to scan" description="Events you are assigned to appear here once they are published." />
        : (
          <View style={{ gap: 10 }}>
            {data.events.map((e) => (
              <Pressable key={`${e.orgSlug}-${e.eventId}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/scan/[org]/[eventId]', params: { org: e.orgSlug, eventId: String(e.eventId), title: e.title } })}
                style={({ pressed }) => [styles.row, pressed ? { opacity: 0.9 } : null]}>
                <View style={styles.icon}><ScanLine size={20} color={colors.red} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" numberOfLines={2}>{e.title}</Txt>
                  <Txt variant="caption">{e.when}{e.venue ? ` · ${e.venue}` : ''}</Txt>
                  <Txt variant="caption">{e.orgName} · {e.counts.used}/{e.counts.total} checked in</Txt>
                </View>
                <ChevronRight size={18} color={red(0.5)} />
              </Pressable>
            ))}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
});
