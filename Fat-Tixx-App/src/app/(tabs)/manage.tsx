import { View } from 'react-native';
import { router } from 'expo-router';
import { Building2, Shield } from 'lucide-react-native';
import { useManageOverview } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { NavRow, StatGrid } from '@/components/manage/Stats';
import { Button, EmptyState, ErrorState, Screen, Skeleton, StatusBadge, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { openWeb } from '@/lib/web';
import { colors } from '@/theme/tokens';

/**
 * Manage: the organiser dashboard and admin panel for every role. Native screens cover the daily work
 * (sales, attendees, orders, check-in, platform health); everything else opens the website inside the app.
 */
export default function ManageScreen() {
  const { status, account } = useAuth();
  const signedIn = status === 'signed-in' && !!account;
  const { data, isLoading, isError, error, refetch, isRefetching } = useManageOverview(signedIn);
  const roles = account?.user.roles ?? [];

  if (!signedIn) return <Screen title="Manage"><EmptyState title="Sign in to manage events" action={<Button title="Sign in" onPress={() => router.push('/login')} />} /></Screen>;

  return (
    <Screen title="Manage" refreshing={isRefetching} onRefresh={refetch}>
      {roles.length ? (
        <View style={{ gap: 10, marginBottom: 20 }}>
          <Txt variant="eyebrow">Platform</Txt>
          <NavRow icon={<Shield size={20} color={colors.red} />} title="Admin panel" sub={`Signed in as ${roles.join(', ').replace(/_/g, ' ')}`} onPress={() => router.push('/admin')} />
        </View>
      ) : null}

      <Txt variant="eyebrow" style={{ marginBottom: 10 }}>Your organizations</Txt>
      {isLoading ? <View style={{ gap: 10 }}><Skeleton style={{ height: 150 }} /><Skeleton style={{ height: 150 }} /></View>
        : isError ? <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        : !data?.orgs.length ? (
          <EmptyState title={roles.length ? 'You are not a member of any organization' : 'No organizations yet'} description="Organizers sell tickets through an organization. Apply on the website to start hosting." action={<Button title="Apply to sell tickets" variant="outline" onPress={() => openWeb('/sell', 'Sell tickets')} />} />
        ) : (
          <View style={{ gap: 14 }}>
            {data.orgs.map((o) => (
              <View key={o.slug} style={{ gap: 10 }}>
                <NavRow icon={<Building2 size={20} color={colors.red} />} title={o.name} sub={`${o.role.replace(/_/g, ' ')}${o.status !== 'active' ? ' · suspended' : ''}`} badge={o.status !== 'active' ? <StatusBadge status={o.status} /> : undefined}
                  onPress={() => router.push({ pathname: '/manage/[org]', params: { org: o.slug, name: o.name } })} />
                {o.overview ? (
                  <StatGrid items={[
                    { label: 'Upcoming events', value: String(o.overview.upcoming), hint: `${o.overview.events} total` },
                    { label: 'Gross sales', value: formatCents(o.overview.grossCents), hint: `${o.overview.paidOrders} paid orders` },
                    { label: 'Tickets sold', value: String(o.overview.ticketsSold) },
                    { label: 'Checked in', value: String(o.overview.checkedIn) },
                  ]} />
                ) : null}
              </View>
            ))}
          </View>
        )}
    </Screen>
  );
}
