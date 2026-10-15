import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ClipboardList, CloudUpload, Download, ScanLine } from 'lucide-react-native';
import { useEventDetail } from '@/api/hooks';
import { NavRow, StatGrid } from '@/components/Stats';
import { Button, Card, Notice, Screen, ScreenLoader, StatusBadge, Tag, Txt } from '@/components/ui';
import { useOfflineList } from '@/scanner/offline';
import { localCounts } from '@/scanner/store';
import { colors } from '@/theme/tokens';

/**
 * One event, everything the Scan Manager does for it: live counts, the camera scanner, the door list
 * (manual check-in, override, undo) and the ticket list kept on this phone for offline scanning.
 * The server decides what the member may do; this screen only reflects it.
 */
export default function EventScreen() {
  const { org, eventId, title } = useLocalSearchParams<{ org: string; eventId: string; title?: string }>();
  const eventNo = Number(eventId);
  const { data, isLoading, isError, error, refetch, isRefetching } = useEventDetail(org, eventId);
  const list = useOfflineList(org, eventNo, () => { void refetch(); });
  const [local, setLocal] = useState<{ total: number; used: number } | null>(null);

  // No answer from the server (no signal): show the counts implied by the list on this phone.
  useEffect(() => {
    if (data) return;
    let on = true;
    localCounts(eventNo).then((c) => { if (on) setLocal(c); }).catch(() => {});
    return () => { on = false; };
  }, [data, eventNo, list.meta, list.queued]);

  if (isLoading && !data) return <Screen back title="Event" scroll={false}><ScreenLoader label="Loading event…" /></Screen>;

  const e = data?.event;
  const counts = data?.counts ?? local;
  const perms = data?.perms;
  const listedAt = list.meta ? new Date(list.meta.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <Screen back title="Event" refreshing={isRefetching} onRefresh={() => { refetch(); list.reload(); }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt variant="title">{e?.title ?? title ?? 'Event'}</Txt>
          {e ? <Txt variant="small" style={{ marginTop: 4 }}>{e.when}{e.venue ? ` · ${e.venue}` : ''}</Txt> : null}
        </View>
        {e ? <StatusBadge status={e.status} /> : null}
      </View>

      {isError && !data ? <View style={{ marginTop: 12 }}><Notice tone="warning" title="Could not reach the server">{list.meta ? 'Scanning still works from the ticket list on this phone.' : (error as Error)?.message ?? 'Check the connection and pull to refresh.'}</Notice></View> : null}

      {counts ? (
        <View style={{ marginTop: 16 }}>
          <StatGrid items={[
            { label: 'Checked in', value: `${counts.used} / ${counts.total}`, hint: data ? 'live' : 'from the list on this phone' },
            { label: 'Still to come', value: String(Math.max(0, counts.total - counts.used)) },
            ...(e ? [{ label: 'Tickets issued', value: `${e.ticketsSold} / ${e.capacity}` }] : []),
          ]} />
        </View>
      ) : null}

      <View style={{ gap: 10, marginTop: 20 }}>
        <Txt variant="eyebrow">Check-in</Txt>
        <NavRow icon={<ScanLine size={20} color={colors.red} />} title="Scan tickets" sub="Camera check-in; works offline from the downloaded list" onPress={() => router.push({ pathname: '/scan/[org]/[eventId]', params: { org, eventId, title: e?.title ?? title } })} />
        <NavRow icon={<ClipboardList size={20} color={colors.red} />} title="Door list" sub={perms?.canOverrideCheckin || perms?.canUndoCheckin ? 'Search guests, check in by name, override and undo' : 'Search guests and check in by name'} onPress={() => router.push({ pathname: '/event/[org]/[eventId]/attendees', params: { org, eventId, title: e?.title ?? title } })} />
        {perms ? <Txt variant="caption">{perms.canOverrideCheckin && perms.canUndoCheckin ? 'You may override and undo check-ins.' : perms.canOverrideCheckin ? 'You may override check-ins; undo needs an organizer with permission.' : perms.canUndoCheckin ? 'You may undo check-ins; overrides need an organizer with permission.' : 'Override and undo need an organizer with permission.'}</Txt> : null}
      </View>

      <Card style={{ marginTop: 20, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="eyebrow" style={{ flex: 1 }}>Tickets on this phone</Txt>
          {list.meta ? <Tag label="Offline ready" /> : null}
        </View>
        <Txt variant="small">{list.meta ? `Downloaded ${listedAt} · ${list.meta.ticketCount.toLocaleString()} tickets. Scanning keeps working if the signal drops; the list refreshes while you scan.` : 'Not downloaded yet. Download the ticket list so scanning works with no signal at the door.'}</Txt>
        {list.queued ? <Txt variant="small" color={colors.amber}>{list.queued} offline check-in{list.queued === 1 ? '' : 's'} waiting to upload.</Txt> : null}
        {list.notice ? <Txt variant="caption">{list.notice}</Txt> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <Button title={list.meta ? 'Update list' : 'Download tickets'} variant={list.meta ? 'outline' : 'primary'} size="sm" icon={<Download size={14} color={list.meta ? colors.red : colors.ivory} />} onPress={() => void list.download()} loading={list.busy === 'download'} disabled={list.busy != null} />
          {list.queued ? <Button title={`Upload ${list.queued}`} variant="outline" size="sm" icon={<CloudUpload size={14} color={colors.red} />} onPress={() => void list.upload()} loading={list.busy === 'upload'} disabled={list.busy != null} /> : null}
        </View>
      </Card>

      {data ? (
        <Card flat style={{ marginTop: 14, gap: 8 }}>
          <Txt variant="eyebrow">Ticket types</Txt>
          {data.ticketTypes.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Txt variant="small" style={{ flex: 1 }}>{t.name}{t.hidden ? ' (access code)' : ''}</Txt>
              <Txt variant="small">{t.sold}/{t.quantity} issued{t.held ? ` (+${t.held} held)` : ''}</Txt>
            </View>
          ))}
          {!data.ticketTypes.length ? <Txt variant="small">No ticket types yet.</Txt> : null}
        </Card>
      ) : null}

      {data ? (
        <Card flat style={{ marginTop: 14, gap: 8 }}>
          <Txt variant="eyebrow">Recent scans</Txt>
          {data.recentScans.length ? data.recentScans.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Txt variant="small" style={{ flex: 1 }}>{s.attendee ?? s.code ?? '—'} · {s.result.replace(/_/g, ' ')}{s.staff ? ` by ${s.staff}` : ''}</Txt>
              <Txt variant="caption">{new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Txt>
            </View>
          )) : <Txt variant="small">No scans yet.</Txt>}
        </Card>
      ) : null}
    </Screen>
  );
}
