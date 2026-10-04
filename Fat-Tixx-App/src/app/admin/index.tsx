import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Building2, Search, UserRound } from 'lucide-react-native';
import { useAdminOrgs, useAdminOverview, useAdminUsers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Chips, NavRow, StatGrid } from '@/components/manage/Stats';
import { Button, Card, EmptyState, ErrorState, Notice, Screen, Skeleton, StatusBadge, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { ADMIN_WEB_SECTIONS, openWeb } from '@/lib/web';
import { colors, fonts, red } from '@/theme/tokens';

type Tab = 'overview' | 'orgs' | 'users' | 'tools';

/**
 * Platform admin (super admin, support, finance): live numbers and health natively, directories of
 * organisations and users, and every admin section of the website inside the app.
 */
export default function AdminScreen() {
  const { status, account } = useAuth();
  const roles = account?.user.roles ?? [];
  const enabled = status === 'signed-in' && roles.length > 0;
  const [tab, setTab] = useState<Tab>('overview');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data, isLoading, isError, error, refetch, isRefetching } = useAdminOverview(enabled);
  const orgs = useAdminOrgs(enabled && tab === 'orgs', debounced);
  const users = useAdminUsers(enabled && tab === 'users' && roles.some((r) => r === 'super_admin' || r === 'support'), debounced);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(v.trim()), 250);
  }

  if (!enabled) return <Screen back title="Admin"><EmptyState title="Platform staff only" action={<Button title="Back" variant="outline" onPress={() => router.back()} />} /></Screen>;

  const tabs: { label: string; value: Tab }[] = [{ label: 'Overview', value: 'overview' }, { label: 'Organizations', value: 'orgs' }, ...(roles.some((r) => r === 'super_admin' || r === 'support') ? [{ label: 'Users', value: 'users' as Tab }] : []), { label: 'All tools', value: 'tools' }];

  return (
    <Screen back title="Admin panel" refreshing={isRefetching} onRefresh={refetch}>
      <Chips value={tab} onChange={setTab} options={tabs} />

      {tab === 'overview' ? (
        isLoading ? <View style={{ gap: 10, marginTop: 16 }}><Skeleton style={{ height: 160 }} /><Skeleton style={{ height: 200 }} /></View>
        : isError || !data ? <View style={{ marginTop: 16 }}><ErrorState message={(error as Error)?.message ?? 'Could not load.'} onRetry={() => refetch()} /></View>
        : (
          <View style={{ marginTop: 16, gap: 16 }}>
            <StatGrid items={[
              { label: 'Gross sales · 30 days', value: formatCents(data.overview.gross30d), hint: `${data.overview.orders30d} paid orders` },
              { label: 'Platform fees · 30 days', value: formatCents(data.overview.fees30d), hint: `Refunds ${formatCents(data.overview.refunds30d)}` },
              { label: 'Tickets issued', value: String(data.overview.ticketsIssued), hint: `${data.overview.checkedIn} checked in` },
              { label: 'Organizations', value: String(data.overview.orgs), hint: `${data.overview.upcomingEvents} upcoming · ${data.overview.users} users` },
            ]} />
            {!data.health.dbOk || data.health.failedEmails || data.health.disputesOpen || data.health.lockedUsers ? (
              <Notice tone="warning" title="Needs attention">
                <Txt variant="small" color={colors.amber}>
                  {[data.health.disputesOpen ? `${data.health.disputesOpen} open dispute${data.health.disputesOpen === 1 ? '' : 's'}` : null, data.health.failedEmails ? `${data.health.failedEmails} failed emails` : null, data.health.lockedUsers ? `${data.health.lockedUsers} locked or suspended users` : null, !data.health.dbOk ? 'database check failed' : null].filter(Boolean).join(' · ')}
                </Txt>
              </Notice>
            ) : <Notice tone="success" title="All systems normal">{`${data.health.failedLogins24h} failed logins and ${data.health.webhooks24h} Stripe webhooks in 24 h · ${data.health.pendingHolds} live holds · ${data.health.queuedEmails} queued emails`}</Notice>}
            <Card flat style={{ gap: 8 }}>
              <Txt variant="eyebrow">Recent orders</Txt>
              {data.recentOrders.map((o) => (
                <View key={o.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}><Txt variant="small" numberOfLines={1}>{o.code} · {o.eventTitle}</Txt><Txt variant="caption" numberOfLines={1}>{o.buyerEmail} · {o.orgName}</Txt></View>
                  <StatusBadge status={o.status} /><Txt variant="mono">{formatCents(o.totalCents, o.currency)}</Txt>
                </View>
              ))}
              {!data.recentOrders.length ? <Txt variant="small">No orders yet.</Txt> : null}
            </Card>
            <Card flat style={{ gap: 6 }}>
              <Txt variant="eyebrow">Recent activity</Txt>
              {data.activity.map((a) => <Txt key={a.id} variant="small"><Txt variant="bodyStrong" style={{ fontSize: 13 }}>{a.action}</Txt> · {a.actor ?? 'system'} · {new Date(a.at).toLocaleString()}</Txt>)}
            </Card>
          </View>
        )
      ) : null}

      {tab === 'orgs' || tab === 'users' ? (
        <View style={{ marginTop: 16, gap: 10 }}>
          <View style={styles.search}><Search size={16} color={red(0.6)} /><TextInput value={q} onChangeText={onSearch} placeholder={tab === 'orgs' ? 'Search organizations' : 'Search users by name or email'} placeholderTextColor={red(0.5)} autoCorrect={false} autoCapitalize="none" style={styles.input} /></View>
          {tab === 'orgs' ? (
            orgs.isLoading ? <Skeleton style={{ height: 160 }} /> : orgs.isError ? <ErrorState message={(orgs.error as Error).message} onRetry={() => orgs.refetch()} /> : (orgs.data?.organizations ?? []).map((o) => (
              <NavRow key={o.slug} icon={<Building2 size={18} color={colors.red} />} title={o.name} badge={o.status !== 'active' ? <StatusBadge status={o.status} /> : undefined}
                sub={`${o.members} members · ${o.events} events · ${o.orders} orders · ${formatCents(o.grossCents)}\n${o.contactEmail}`} onPress={() => openWeb(`/admin/organizations/${o.slug}`, o.name)} />
            ))
          ) : (
            users.isLoading ? <Skeleton style={{ height: 160 }} /> : users.isError ? <ErrorState message={(users.error as Error).message} onRetry={() => users.refetch()} /> : (users.data?.users ?? []).map((u) => (
              <NavRow key={u.email} icon={<UserRound size={18} color={colors.red} />} title={u.name} badge={u.status !== 'active' ? <StatusBadge status={u.status} /> : undefined}
                sub={`${u.email}${u.roles.length ? ` · ${u.roles.join(', ').replace(/_/g, ' ')}` : ''}\n${u.orgCount} orgs · ${u.orderCount} orders · ${u.lastLoginAt ? `last login ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'never signed in'}`}
                onPress={() => openWeb(`/admin/users?q=${encodeURIComponent(u.email)}`, 'Users')} />
            ))
          )}
        </View>
      ) : null}

      {tab === 'tools' ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          <Txt variant="small">Every admin section of the website, signed in as you.</Txt>
          {ADMIN_WEB_SECTIONS.filter((s) => !s.roles || s.roles.some((r) => roles.includes(r))).map((s) => <NavRow key={s.path} title={s.label} onPress={() => openWeb(s.path, s.label)} />)}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink, paddingVertical: 10 },
});
