import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BarChart3, CalendarPlus, Megaphone, Receipt, ScanLine, Settings, Users, MapPin } from 'lucide-react-native';
import { useManageEvents } from '@/api/hooks';
import { Chips, NavRow } from '@/components/manage/Stats';
import { Button, EmptyState, ErrorState, Screen, SectionLoader, StatusBadge, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { openWeb, orgWebPaths } from '@/lib/web';
import { colors } from '@/theme/tokens';

/** One organisation: its events (native) and the rest of the dashboard (website inside the app). */
export default function OrgScreen() {
  const { org, name } = useLocalSearchParams<{ org: string; name?: string }>();
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const { data, isLoading, isError, error, refetch, isRefetching } = useManageEvents(org, filter);
  const paths = orgWebPaths(org);
  const role = data?.org.role ?? '';
  const staff = role === 'staff';
  const admin = role === 'org_admin' || role === 'super_admin';

  const tools = [
    ...(!staff ? [{ label: 'New event', icon: CalendarPlus, path: paths.newEvent }] : []),
    { label: 'Orders', icon: Receipt, onPress: () => router.push({ pathname: '/manage/[org]/orders', params: { org } }), hide: staff },
    { label: 'Analytics', icon: BarChart3, path: paths.analytics, hide: staff },
    { label: 'Marketing', icon: Megaphone, path: paths.marketing, hide: staff },
    { label: 'Venues', icon: MapPin, path: paths.venues, hide: staff },
    { label: 'Team', icon: Users, path: paths.team, hide: !admin },
    { label: 'Settings', icon: Settings, path: paths.settings, hide: !admin },
    { label: 'Scan', icon: ScanLine, onPress: () => router.navigate('/scan') },
  ].filter((t) => !('hide' in t && t.hide));

  return (
    <Screen back title={data?.org.name ?? name ?? 'Organization'} refreshing={isRefetching} onRefresh={refetch}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
        {tools.map((t) => (
          <Button key={t.label} title={t.label} variant="outline" size="sm" icon={<t.icon size={15} color={colors.red} />} onPress={() => ('path' in t && t.path ? openWeb(t.path, `${data?.org.name ?? ''} · ${t.label}`) : t.onPress?.())} />
        ))}
      </ScrollView>

      <View style={{ marginTop: 18, gap: 10 }}>
        <Txt variant="eyebrow">Events</Txt>
        <Chips value={filter} onChange={setFilter} options={[{ label: 'Upcoming', value: 'upcoming' }, { label: 'Past', value: 'past' }, { label: 'All', value: 'all' }]} />
      </View>

      <View style={{ gap: 10, marginTop: 12 }}>
        {isLoading ? <SectionLoader label="Loading events…" />
          : isError ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          : !data?.events.length ? <EmptyState title={filter === 'upcoming' ? 'No upcoming events' : 'No events'} description={staff ? 'You have not been assigned to any event yet.' : 'Create your first event to start selling tickets.'} action={!staff ? <Button title="New event" onPress={() => openWeb(paths.newEvent, 'New event')} /> : undefined} />
          : data.events.map((e) => (
            <NavRow key={e.id} title={e.title} badge={<StatusBadge status={e.status} />}
              sub={`${e.when}${e.venue ? ` · ${e.venue}` : ''}\n${e.ticketsSold}/${e.capacity} sold · ${e.checkedIn} checked in${e.grossCents != null ? ` · ${formatCents(e.grossCents, e.currency)}` : ''}`}
              onPress={() => router.push({ pathname: '/manage/[org]/events/[eventId]', params: { org, eventId: String(e.id) } })} />
          ))}
      </View>
    </Screen>
  );
}
