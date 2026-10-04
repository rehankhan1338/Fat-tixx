import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ClipboardList, FileText, Pencil, Receipt, ScanLine, Share2, Wallet } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { api } from '@/api/client';
import { useManageEvent } from '@/api/hooks';
import { NavRow, StatGrid } from '@/components/manage/Stats';
import { Button, Card, ErrorState, Notice, Screen, ScreenLoader, StatusBadge, Txt } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { formatCents } from '@/lib/format';
import { openWeb, orgWebPaths } from '@/lib/web';
import { colors } from '@/theme/tokens';

/** Event management: live sales and check-in figures, quick actions, and the full editor on the website. */
export default function ManageEventScreen() {
  const { org, eventId } = useLocalSearchParams<{ org: string; eventId: string }>();
  const { data, isLoading, isError, error, refetch, isRefetching } = useManageEvent(org, eventId);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const paths = orgWebPaths(org);
  const id = Number(eventId);

  async function setStatus(status: 'draft' | 'published' | 'completed') {
    setBusy(true); setMsg(null);
    try {
      await api(`/manage/${org}/events/${eventId}`, { method: 'POST', body: { status } });
      await queryClient.invalidateQueries({ queryKey: ['me:manage'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  function confirmStatus(status: 'draft' | 'published' | 'completed') {
    const label = status === 'published' ? 'Publish this event? It becomes visible and tickets go on sale.' : status === 'draft' ? 'Unpublish this event? It disappears from the site; existing tickets stay valid.' : 'Mark this event as completed?';
    Alert.alert(status === 'published' ? 'Publish' : status === 'draft' ? 'Unpublish' : 'Complete', label, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => { void setStatus(status); } }]);
  }

  if (isLoading) return <Screen back title="Event" scroll={false}><ScreenLoader label="Loading event…" /></Screen>;
  if (isError || !data) return <Screen back title="Event"><ErrorState message={(error as Error)?.message ?? 'Event not found.'} onRetry={() => refetch()} /></Screen>;
  const { event: e, counts, sales, perms } = data;
  const publicUrl = `${API_URL}/events/${e.slug}`;

  return (
    <Screen back title="Event" refreshing={isRefetching} onRefresh={refetch}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{e.title}</Txt>
          <Txt variant="small" style={{ marginTop: 4 }}>{e.when}{e.venue ? ` · ${e.venue}` : ''}</Txt>
        </View>
        <StatusBadge status={e.status} />
      </View>
      {e.visibility !== 'public' ? <Txt variant="caption" style={{ marginTop: 4 }}>{e.visibility === 'private' ? 'Private event (link with key only)' : 'Unlisted event'}</Txt> : null}

      <View style={{ marginTop: 16 }}>
        <StatGrid items={[
          { label: 'Checked in', value: `${counts.used} / ${counts.total}` },
          { label: 'Tickets sold', value: `${e.ticketsSold} / ${e.capacity}` },
          ...(sales ? [
            { label: 'Gross sales', value: formatCents(sales.grossCents, e.currency), hint: `${sales.paidOrders} paid orders` },
            { label: 'Net to organizer', value: formatCents(sales.payoutCents, e.currency), hint: sales.refundedCents ? `${formatCents(sales.refundedCents, e.currency)} refunded` : 'no refunds' },
          ] : []),
        ]} />
      </View>

      {msg ? <View style={{ marginTop: 12 }}><Notice tone="error">{msg}</Notice></View> : null}

      <View style={{ gap: 10, marginTop: 20 }}>
        <Txt variant="eyebrow">Actions</Txt>
        <NavRow icon={<ScanLine size={20} color={colors.red} />} title="Scan tickets" sub="Camera check-in for this event" onPress={() => router.push({ pathname: '/scan/[org]/[eventId]', params: { org, eventId, title: e.title } })} />
        <NavRow icon={<ClipboardList size={20} color={colors.red} />} title="Attendees & door list" sub="Search guests, check in by name, undo mistakes" onPress={() => router.push({ pathname: '/manage/[org]/events/[eventId]/attendees', params: { org, eventId, title: e.title } })} />
        {perms.canEdit ? <NavRow icon={<Receipt size={20} color={colors.red} />} title="Orders" sub="Find an order, resend tickets, refund" onPress={() => router.push({ pathname: '/manage/[org]/orders', params: { org, eventId } })} /> : null}
        {perms.canEdit ? <NavRow icon={<Pencil size={20} color={colors.red} />} title="Edit event" sub="Details, ticket types, add-ons, questions, schedule, team" onPress={() => openWeb(paths.event(id), e.title)} /> : null}
        <NavRow icon={<FileText size={20} color={colors.red} />} title="Printable door list" onPress={() => openWeb(paths.doorList(id), 'Door list')} />
        {perms.canEdit ? <NavRow icon={<Wallet size={20} color={colors.red} />} title="Settlement statement" onPress={() => openWeb(paths.settlement(id), 'Settlement')} /> : null}
        <NavRow icon={<Share2 size={20} color={colors.red} />} title="Share event link" sub={publicUrl} onPress={() => Sharing.isAvailableAsync().then((ok) => ok ? Sharing.shareAsync(publicUrl, { dialogTitle: e.title }) : openWeb(`/events/${e.slug}`, e.title)).catch(() => {})} />
      </View>

      {perms.canChangeStatus ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {e.status === 'draft' ? <Button title="Publish" onPress={() => confirmStatus('published')} loading={busy} /> : null}
          {e.status === 'published' || e.status === 'postponed' ? <Button title="Unpublish" variant="outline" onPress={() => confirmStatus('draft')} loading={busy} /> : null}
          {e.status === 'published' ? <Button title="Mark completed" variant="outline" onPress={() => confirmStatus('completed')} loading={busy} /> : null}
          <Button title="Cancel / postpone (web)" variant="ghost" onPress={() => openWeb(paths.event(id), e.title)} />
        </View>
      ) : null}

      <Card flat style={{ marginTop: 20, gap: 8 }}>
        <Txt variant="eyebrow">Ticket types</Txt>
        {data.ticketTypes.map((t) => (
          <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <Txt variant="small" style={{ flex: 1 }}>{t.name}{t.hidden ? ' (access code)' : ''}{t.priceCents != null ? ` · ${t.priceCents ? formatCents(t.priceCents, e.currency) : 'Free'}` : ''}</Txt>
            <Txt variant="small">{t.sold}/{t.quantity}{t.held ? ` (+${t.held} held)` : ''}</Txt>
          </View>
        ))}
        {!data.ticketTypes.length ? <Txt variant="small">No ticket types yet.</Txt> : null}
      </Card>

      <Card flat style={{ marginTop: 14, gap: 8 }}>
        <Txt variant="eyebrow">Recent scans</Txt>
        {data.recentScans.length ? data.recentScans.map((s) => (
          <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <Txt variant="small" style={{ flex: 1 }}>{s.attendee ?? s.code ?? '—'} · {s.result.replace(/_/g, ' ')}{s.staff ? ` by ${s.staff}` : ''}</Txt>
            <Txt variant="caption">{new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Txt>
          </View>
        )) : <Txt variant="small">No scans yet.</Txt>}
      </Card>
    </Screen>
  );
}
