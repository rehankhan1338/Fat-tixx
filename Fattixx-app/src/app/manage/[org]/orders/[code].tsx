import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Mail, Phone, RefreshCw, Undo2 } from 'lucide-react-native';
import { api } from '@/api/client';
import { useManageOrder } from '@/api/hooks';
import { Button, Card, ErrorState, Notice, Screen, ScreenLoader, StatusBadge, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { openWeb, orgWebPaths } from '@/lib/web';
import { colors, red } from '@/theme/tokens';

/** Staff view of one order: buyer, tickets with check-in state, receipt, refunds, resend. */
export default function ManageOrderScreen() {
  const { org, code } = useLocalSearchParams<{ org: string; code: string }>();
  const { data: o, isLoading, isError, error, refetch, isRefetching } = useManageOrder(org, code);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function resend() {
    setBusy(true); setMsg(null);
    try { const r = await api<{ message: string }>(`/manage/${org}/orders/${code}`, { method: 'POST', body: { action: 'resend' } }); setMsg({ tone: 'success', text: r.message }); }
    catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  }

  if (isLoading) return <Screen back title="Order" scroll={false}><ScreenLoader label="Loading order…" /></Screen>;
  if (isError || !o) return <Screen back title="Order"><ErrorState message={(error as Error)?.message ?? 'Order not found.'} onRetry={() => refetch()} /></Screen>;
  const t = o.totals;

  return (
    <Screen back title={o.code} refreshing={isRefetching} onRefresh={refetch}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}><Txt variant="title">{o.event.title}</Txt><Txt variant="small">{o.event.when}</Txt></View>
        <StatusBadge status={o.status} />
      </View>

      <Card style={{ marginTop: 16, gap: 6 }}>
        <Txt variant="eyebrow">Buyer</Txt>
        <Txt variant="bodyStrong">{o.buyerName ?? '—'}</Txt>
        <Txt variant="small" onPress={() => Linking.openURL(`mailto:${o.buyerEmail}`)}><Mail size={12} color={red(0.6)} /> {o.buyerEmail}</Txt>
        {o.buyerPhone ? <Txt variant="small" onPress={() => Linking.openURL(`tel:${o.buyerPhone}`)}><Phone size={12} color={red(0.6)} /> {o.buyerPhone}</Txt> : null}
        <Txt variant="caption">Placed {new Date(o.createdAt).toLocaleString()}{o.paidAt ? ` · paid ${new Date(o.paidAt).toLocaleString()}` : ''} · {o.source.replace('_', ' ')}</Txt>
      </Card>

      {msg ? <View style={{ marginTop: 12 }}><Notice tone={msg.tone}>{msg.text}</Notice></View> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {o.perms.canResend ? <Button title="Resend tickets" variant="outline" size="sm" icon={<RefreshCw size={14} color={colors.red} />} onPress={() => Alert.alert('Resend tickets', `Email the tickets to ${o.buyerEmail} again?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => { void resend(); } }])} loading={busy} /> : null}
        {o.perms.canRefund && ['paid', 'partially_refunded'].includes(o.status) ? <Button title="Refund (web)" variant="outline" size="sm" icon={<Undo2 size={14} color={colors.red} />} onPress={() => openWeb(orgWebPaths(org).order(o.code), `Order ${o.code}`)} /> : null}
        <Button title="Open on web" variant="ghost" size="sm" onPress={() => openWeb(orgWebPaths(org).order(o.code), `Order ${o.code}`)} />
      </View>

      <View style={{ gap: 8, marginTop: 18 }}>
        <Txt variant="eyebrow">Tickets</Txt>
        {o.tickets.map((tk) => (
          <Card key={tk.id} flat style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">{tk.attendeeName ?? o.buyerName ?? '—'}</Txt>
              <Txt variant="caption">{tk.type}{tk.dayLabel ? ` · ${tk.dayLabel}` : ''}{tk.seatLabel ? ` · ${tk.seatLabel}` : ''} · {tk.code}</Txt>
              {tk.transferredTo ? <Txt variant="caption">Transferred to {tk.transferredTo}</Txt> : null}
            </View>
            <StatusBadge status={tk.status} />
          </Card>
        ))}
      </View>

      <Card flat style={{ marginTop: 18, gap: 6 }}>
        <Txt variant="eyebrow">Receipt</Txt>
        {o.items.map((i) => <Line key={i.id} label={`${i.quantity} × ${i.name}`} value={formatCents(i.lineCents, o.currency)} />)}
        {o.addons.map((a) => <Line key={`a${a.id}`} label={`${a.quantity} × ${a.name} (add-on)`} value={formatCents(a.lineCents, o.currency)} />)}
        {t.discountCents ? <Line label="Promo discount" value={`−${formatCents(t.discountCents, o.currency)}`} /> : null}
        {t.platformFeeCents ? <Line label="Service fee" value={formatCents(t.platformFeeCents, o.currency)} /> : null}
        {t.processingFeeCents ? <Line label="Card processing" value={formatCents(t.processingFeeCents, o.currency)} /> : null}
        {t.taxCents ? <Line label="Tax" value={formatCents(t.taxCents, o.currency)} /> : null}
        <Line label="Total" value={formatCents(t.totalCents, o.currency)} strong />
        {t.refundedCents ? <Line label="Refunded" value={`−${formatCents(t.refundedCents, o.currency)}`} /> : null}
      </Card>

      {o.refunds.length ? (
        <Card flat style={{ marginTop: 14, gap: 6 }}>
          <Txt variant="eyebrow">Refunds</Txt>
          {o.refunds.map((r) => <Txt key={r.id} variant="small">{formatCents(r.amountCents, o.currency)} · {r.kind} · {r.status} · {new Date(r.at).toLocaleDateString()}{r.by ? ` by ${r.by}` : ''}{r.reason ? `\n${r.reason}` : ''}</Txt>)}
        </Card>
      ) : null}
    </Screen>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
      <Txt variant={strong ? 'bodyStrong' : 'small'} style={{ flex: 1 }}>{label}</Txt>
      <Txt variant={strong ? 'bodyStrong' : 'mono'}>{value}</Txt>
    </View>
  );
}
