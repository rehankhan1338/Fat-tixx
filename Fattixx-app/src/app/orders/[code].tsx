import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { CheckCircle2, Mail, Maximize2, Send } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useOrder } from '@/api/hooks';
import type { OrderDetail, Ticket } from '@/api/types';
import { rememberedOrderToken } from '@/auth/secure';
import { TicketQr } from '@/components/TicketQr';
import { Button, Card, ErrorState, Field, Notice, Screen, ScreenLoader, StatusBadge, Txt } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { formatCents } from '@/lib/format';
import { colors, red } from '@/theme/tokens';

/** Order confirmation + tickets (the website's /orders/[code]). */
export default function OrderScreen() {
  const { code, t: tParam } = useLocalSearchParams<{ code: string; t?: string }>();
  const [t, setT] = useState<string | null | undefined>(tParam ?? undefined);
  // Opened from the Tickets tab without a token in the link: look up the one remembered on this device.
  useEffect(() => { if (!tParam) rememberedOrderToken(code).then((v) => setT(v)); }, [code, tParam]);
  const { data: order, isLoading, isError, error, refetch, isRefetching } = useOrder(t === undefined ? undefined : code, t);

  useEffect(() => {
    if (order?.status === 'pending') router.replace({ pathname: '/checkout/[code]', params: t ? { code, t } : { code } });
  }, [order, code, t]);

  if (isLoading || t === undefined) return <Screen back title="Your order" scroll={false}><ScreenLoader label="Loading your tickets…" /></Screen>;
  if (isError || !order) return <Screen back title="Your order"><ErrorState message={(error as Error)?.message ?? 'Order not found.'} onRetry={() => refetch()} /></Screen>;
  const tot = order.totals;

  return (
    <Screen back title="Your order" refreshing={isRefetching} onRefresh={refetch} keyboard>
      {order.status === 'paid' ? (
        <Notice tone="success" title={`You’re going! Your tickets are below and on their way to ${order.buyerEmail}.`}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}><CheckCircle2 size={14} color={colors.emerald} style={{ marginTop: 2 }} /><Txt variant="small" color={colors.emerald} style={{ flex: 1 }}>Show the QR code at the door, on your phone or printed.{order.event.ageRestriction ? ` This event is ${order.event.ageRestriction}+; bring a valid photo ID.` : ''}</Txt></View>
        </Notice>
      ) : (
        <Notice tone="info" title={`Order ${order.code}`}><View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Txt variant="small">Status</Txt><StatusBadge status={order.status} /></View></Notice>
      )}

      <Txt variant="display" style={{ marginTop: 18 }}>{order.event.title}</Txt>
      <Txt variant="body" style={{ marginTop: 4 }}>{order.event.when}{order.event.venue ? ` · ${order.event.venue}` : ''}</Txt>

      <View style={{ gap: 14, marginTop: 18 }}>
        {order.tickets.map((tk) => <TicketCard key={tk.id} order={order} ticket={tk} token={t} />)}
      </View>

      <Card style={{ marginTop: 20, gap: 8 }}>
        <Txt variant="heading">Receipt · <Txt variant="mono" style={{ fontSize: 15 }}>{order.code}</Txt></Txt>
        {order.items.map((i) => <Line key={i.id} label={`${i.quantity} × ${i.name}`} value={formatCents(i.lineCents, order.currency)} />)}
        {order.addons.map((a) => <Line key={`a${a.id}`} label={`${a.quantity} × ${a.name} (add-on)`} value={formatCents(a.lineCents, order.currency)} />)}
        {tot.discountCents ? <Line label="Promo discount" value={`−${formatCents(tot.discountCents, order.currency)}`} color={colors.emerald} /> : null}
        {tot.platformFeeCents ? <Line label="Service fee" value={formatCents(tot.platformFeeCents, order.currency)} muted /> : null}
        {tot.processingFeeCents ? <Line label="Card processing" value={formatCents(tot.processingFeeCents, order.currency)} muted /> : null}
        {tot.taxCents ? <Line label="Tax" value={formatCents(tot.taxCents, order.currency)} muted /> : null}
        <View style={styles.divider} />
        <View style={styles.line}><Txt variant="bodyStrong">Total paid</Txt><Txt variant="bodyStrong">{formatCents(tot.totalCents, order.currency)}</Txt></View>
        {tot.refundedCents ? <Line label="Refunded" value={`−${formatCents(tot.refundedCents, order.currency)}`} color={colors.redBright} /> : null}
        {order.addons.length ? <Txt variant="caption">Add-ons have no QR code: show your order number {order.code} at the venue to collect them.</Txt> : null}
        <Txt variant="caption">Sold by {order.event.organizer} via Fat Tixx.</Txt>
      </Card>

      <Card flat style={{ marginTop: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Mail size={16} color={red(0.6)} /><Txt variant="small">A copy was emailed to {order.buyerEmail}.</Txt></View>
        {order.mayRefund
          ? <Button title="Request a refund (opens website)" variant="outline" size="sm" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/orders/${order.code}${t ? `?t=${encodeURIComponent(t)}` : ''}`)} />
          : <Txt variant="caption">Refunds: {order.event.refundPolicy === 'no_refunds' ? 'not available except if the event is cancelled.' : 'no longer available for this order.'}</Txt>}
      </Card>
    </Screen>
  );
}

function TicketCard({ order, ticket, token }: { order: OrderDetail; ticket: Ticket; token: string | null }) {
  const live = ['valid', 'used'].includes(ticket.status);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ticket.attendeeName ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function save() {
    setSaving(true); setErr(null);
    try {
      await api(`/orders/${encodeURIComponent(order.code)}/attendee`, { method: 'POST', body: { t: token, ticketId: ticket.id, name: name.trim() } });
      await queryClient.invalidateQueries({ queryKey: ['order', order.code] });
      setEditing(false);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Card style={[{ gap: 10 }, live ? null : { opacity: 0.6 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{ticket.type}</Txt>
          {ticket.dayLabel ? <Txt variant="caption">Valid {ticket.dayLabel}</Txt> : null}
          {ticket.seatLabel ? <Txt variant="caption">{ticket.seatLabel}</Txt> : null}
        </View>
        <StatusBadge status={ticket.status} />
      </View>
      {ticket.transferredTo ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 }}><Send size={16} color={red(0.6)} /><Txt variant="small">Transferred to {ticket.transferredTo}</Txt></View>
      ) : ticket.qr ? (
        <>
          <TicketQr payload={ticket.qr} size={176} code={ticket.code} />
          {editing ? (
            <View style={{ gap: 8 }}>
              <Field label="Attendee name" value={name} onChangeText={setName} autoFocus maxLength={160} error={err} />
              <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Save" size="sm" onPress={save} loading={saving} /><Button title="Cancel" size="sm" variant="ghost" onPress={() => setEditing(false)} /></View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Txt variant="small" style={{ flex: 1 }}>Attendee: <Txt variant="bodyStrong" style={{ fontSize: 13 }}>{ticket.attendeeName ?? order.buyerName ?? '—'}</Txt></Txt>
              {ticket.status === 'valid' ? <Button title="Edit name" size="sm" variant="ghost" onPress={() => setEditing(true)} /> : null}
            </View>
          )}
          <Button title="Open full-screen ticket" variant="outline" size="sm" full icon={<Maximize2 size={14} color={colors.red} />}
            onPress={() => router.push({ pathname: '/ticket/[code]', params: { code: ticket.code, order: order.code, ...(token ? { t: token } : {}) } })} />
        </>
      ) : <Txt variant="small" center>This ticket is no longer valid.</Txt>}
    </Card>
  );
}

function Line({ label, value, muted, color }: { label: string; value: string; muted?: boolean; color?: string }) {
  return (
    <View style={styles.line}>
      <Txt variant={muted ? 'small' : 'body'} color={color} style={{ flex: 1 }}>{label}</Txt>
      <Txt variant="mono" color={color ?? (muted ? red(0.6) : colors.red)}>{value}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({ line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, divider: { height: 1, backgroundColor: red(0.1), marginVertical: 4 } });
