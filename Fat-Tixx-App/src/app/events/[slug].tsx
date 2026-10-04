import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Calendar, Clock, KeyRound, MapPin, Repeat, ShieldCheck } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { EventDetail, QueueStatus } from '@/api/types';
import { useEvent } from '@/api/hooks';
import { getQueueToken, setQueueToken } from '@/auth/secure';
import { TicketSelector } from '@/components/TicketSelector';
import { Button, Card, ErrorState, Field, Notice, Screen, Skeleton, Tag, Txt } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { colors, radius, red } from '@/theme/tokens';

/** Public event page: image, details, tickets card (same information architecture as /events/[slug] on the web). */
export default function EventScreen() {
  const { slug, key, code } = useLocalSearchParams<{ slug: string; key?: string; code?: string }>();
  const [accessCode, setAccessCode] = useState(code ?? '');
  const [draftCode, setDraftCode] = useState('');
  const [queueToken, setQueue] = useState<string | null>(null);
  useEffect(() => { getQueueToken(slug).then(setQueue); }, [slug]);
  const { data, isLoading, isError, error, refetch, isRefetching } = useEvent(slug, accessCode, key ?? null, queueToken);

  if (isLoading) {
    return (
      <Screen back title="Event">
        <Skeleton style={{ aspectRatio: 16 / 9, borderRadius: radius.xl }} />
        <Skeleton style={{ height: 34, width: '80%', marginTop: 18 }} />
        <Skeleton style={{ height: 20, width: '60%', marginTop: 10 }} />
        <Skeleton style={{ height: 120, marginTop: 24 }} />
      </Screen>
    );
  }
  if (isError || !data) {
    return <Screen back title="Event"><ErrorState message={(error as Error)?.message ?? 'Event not found.'} onRetry={() => refetch()} /></Screen>;
  }
  const { event } = data;
  const when = event.dates.length > 1 ? null : new Intl.DateTimeFormat('en-US', { timeZone: event.timezone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(event.startsAt));
  const doors = event.doorsAt ? new Intl.DateTimeFormat('en-US', { timeZone: event.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(event.doorsAt)) : null;
  const address = [event.venue.address, event.venue.city, event.venue.region].filter(Boolean).join(', ');

  return (
    <Screen back title={event.organizer.name} refreshing={isRefetching} onRefresh={refetch} keyboard>
      {data.preview ? <Notice tone="warning" title="Preview">This event is {event.status}. Only your team can see this page.</Notice> : null}
      {event.status === 'postponed' ? <Notice tone="warning" title="This event has been postponed.">Existing tickets remain valid for the new date.</Notice> : null}
      <View style={styles.image}>
        {event.imageUrl ? <Image source={{ uri: event.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" />
          : <Txt style={styles.placeholder}>FT</Txt>}
      </View>
      <View style={styles.tags}>
        {event.ageRestriction ? <Tag label={`${event.ageRestriction}+ event · ID required`} /> : null}
        {event.dates.length > 1 ? <Tag label={`${event.dates.length}-day event`} /> : null}
        <Tag label={`by ${event.organizer.name}`} tone="yellow" />
      </View>
      <Txt variant="display" style={{ marginTop: 10 }}>{event.title}</Txt>
      {event.summary ? <Txt variant="body" style={{ marginTop: 8, fontSize: 16 }}>{event.summary}</Txt> : null}

      <View style={styles.facts}>
        <Fact icon={<Calendar size={20} color={colors.red} />} label={event.dates.length > 1 ? 'Dates' : 'Date & time'}>
          {event.dates.length > 1 ? event.dates.map((d) => <Txt key={d.id} variant="small"><Txt variant="bodyStrong" style={{ fontSize: 13 }}>{d.label}</Txt> · {d.when}</Txt>) : <Txt variant="bodyStrong">{when}</Txt>}
        </Fact>
        {doors && event.dates.length <= 1 ? <Fact icon={<Clock size={20} color={colors.red} />} label="Doors open"><Txt variant="bodyStrong">{doors}</Txt></Fact> : null}
        {event.venue.name ? (
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(`${event.venue.name}, ${address}`)}`)}>
            <Fact icon={<MapPin size={20} color={colors.red} />} label="Venue"><Txt variant="bodyStrong">{event.venue.name}</Txt>{address ? <Txt variant="small">{address}</Txt> : null}</Fact>
          </Pressable>
        ) : null}
      </View>

      {event.siblings.length ? (
        <Card flat style={{ marginTop: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Repeat size={14} color={red(0.6)} /><Txt variant="caption">More dates for this event</Txt></View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {event.siblings.map((s) => <Button key={s.slug} title={s.when} variant="outline" size="sm" onPress={() => router.push({ pathname: '/events/[slug]', params: s.key ? { slug: s.slug, key: s.key } : { slug: s.slug } })} />)}
          </View>
        </Card>
      ) : null}

      {event.description ? <Txt variant="body" style={{ marginTop: 20 }}>{event.description}</Txt> : null}

      {event.sponsors.length ? (
        <Card flat style={{ marginTop: 20, gap: 10 }}>
          <Txt variant="eyebrow">Sponsored by</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            {event.sponsors.map((s) => (
              <Pressable key={s.id} disabled={!s.url} onPress={() => s.url && WebBrowser.openBrowserAsync(s.url)} style={{ alignItems: 'center', gap: 4 }}>
                {s.logoUrl ? <Image source={{ uri: s.logoUrl }} style={{ height: 40, width: 120 }} contentFit="contain" /> : <Txt variant="bodyStrong">{s.name}</Txt>}
                {s.tier ? <Txt variant="caption">{s.tier}</Txt> : null}
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      <Txt variant="caption" style={{ marginTop: 16 }}>Refunds: {event.refundText}</Txt>

      <Card style={{ marginTop: 24, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt variant="title">Tickets</Txt>
          {data.soldOut ? <Tag label="Sold out" /> : null}
        </View>
        <TicketsBody data={data} slug={slug} queueToken={queueToken} onQueueToken={async (t) => { await setQueueToken(slug, t); setQueue(t); }} />
        {data.isLive && data.hasPresale && !data.inQueue ? (
          <View style={styles.presale}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><KeyRound size={14} color={red(0.6)} /><Txt variant="caption">Have an access or presale code?</Txt></View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><Field label="Code" value={draftCode} onChangeText={(v) => setDraftCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={40} placeholder="Enter code" /></View>
              <Button title="Unlock" variant="red" size="md" onPress={() => setAccessCode(draftCode.trim())} style={{ marginBottom: 1 }} />
            </View>
            {data.codeRejected ? <Txt variant="caption" color={colors.redBright}>That code is not valid for this event.</Txt>
              : data.unlockedNames.length ? <Txt variant="caption" color={colors.emerald}>Code accepted — {data.unlockedNames.join(', ')} unlocked.</Txt> : null}
          </View>
        ) : null}
        {data.showWaitlist ? (
          <Notice tone="info" title="Sold out? Join the waitlist.">
            <Txt variant="small">We’ll email you if tickets free up. </Txt>
            <Button title="Join on the website" variant="outline" size="sm" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/events/${event.slug}${event.key ? `?key=${event.key}` : ''}#waitlist`)} style={{ marginTop: 8 }} />
          </Notice>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <ShieldCheck size={14} color={red(0.6)} style={{ marginTop: 2 }} />
          <Txt variant="caption" style={{ flex: 1 }}>{data.feeNote} Card details are handled by Stripe and never stored by Fat Tixx.</Txt>
        </View>
      </Card>
    </Screen>
  );
}

function TicketsBody({ data, slug, queueToken, onQueueToken }: { data: EventDetail; slug: string; queueToken: string | null; onQueueToken: (t: string) => Promise<void> }) {
  if (!data.isLive && data.event.status !== 'postponed') return <Txt variant="small">Tickets go on sale when this event is published.</Txt>;
  if (data.tickets.length === 0 && !data.hasPresale) return <Txt variant="small">No tickets available.</Txt>;
  if (data.tickets.length === 0) return <Txt variant="small">Tickets are available with an access code.</Txt>;
  if (data.inQueue) return <WaitingRoom slug={slug} token={queueToken} onToken={onQueueToken} />;
  return <TicketSelector detail={data} queueToken={queueToken} />;
}

/** Virtual waiting room: polls the queue every few seconds and refreshes the page once admitted. */
function WaitingRoom({ slug, token, onToken }: { slug: string; token: string | null; onToken: (t: string) => Promise<void> }) {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api<QueueStatus>(`/events/${encodeURIComponent(slug)}/queue`, { headers: token ? { 'X-Fx-Queue-Token': token } : undefined, anonymous: true });
        if (!alive) return;
        if (s.token) await onToken(s.token);
        setStatus(s);
        if (s.admitted) { queryClient.invalidateQueries({ queryKey: ['event', slug] }); return; }
      } catch { /* retry on the next tick */ }
      if (alive) timer = setTimeout(tick, 4000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [slug, token, onToken, queryClient]);
  return (
    <Notice tone="warning" title="You’re in line">
      <Txt variant="small" color={colors.amber}>{status && !status.admitted ? `${status.ahead} ${status.ahead === 1 ? 'person' : 'people'} ahead of you · about ${status.etaMinutes} min. Keep this screen open.` : 'Checking your place in line…'}</Txt>
    </Notice>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fact}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="caption">{label}</Txt>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { aspectRatio: 16 / 9, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: red(0.08), alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  placeholder: { fontSize: 64, fontFamily: 'BricolageGrotesque_800ExtraBold', color: red(0.25) },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  facts: { gap: 10, marginTop: 20 },
  fact: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  presale: { gap: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: red(0.2) },
});
