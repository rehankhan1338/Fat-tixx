import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { usePaymentSheet } from '@stripe/stripe-react-native';
import { api } from '@/api/client';
import { useConfig, useOrder } from '@/api/hooks';
import type { PaymentIntentResponse } from '@/api/types';
import { HoldCountdown } from '@/components/HoldCountdown';
import { Button, Card, ErrorState, Notice, Screen, Skeleton, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { colors, red } from '@/theme/tokens';

/**
 * Payment step. Card / Apple Pay / Google Pay through Stripe's native PaymentSheet: card numbers go straight
 * from Stripe's UI to Stripe, never through this app or the Fat Tixx server. Free orders confirm directly.
 */
export default function CheckoutScreen() {
  const { code, t } = useLocalSearchParams<{ code: string; t?: string }>();
  const { data: order, isLoading, isError, error, refetch } = useOrder(code, t);
  const { data: config } = useConfig();
  const { initPaymentSheet, presentPaymentSheet, loading: sheetLoading } = usePaymentSheet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (order && order.status !== 'pending') router.replace({ pathname: '/orders/[code]', params: t ? { code, t } : { code } });
  }, [order, code, t]);

  const finish = useCallback(async () => {
    const r = await api<{ ok: boolean }>(`/orders/${encodeURIComponent(code)}/confirm`, { method: 'POST', body: { t } });
    if (r.ok) router.replace({ pathname: '/orders/[code]', params: t ? { code, t } : { code } });
  }, [code, t]);

  async function pay() {
    if (!order) return;
    setErr(null); setBusy(true);
    try {
      const pi = await api<PaymentIntentResponse>(`/orders/${encodeURIComponent(code)}/payment-intent`, { method: 'POST', body: { t } });
      const init = await initPaymentSheet({
        paymentIntentClientSecret: pi.clientSecret,
        merchantDisplayName: config?.name ?? 'Fat Tixx',
        defaultBillingDetails: { email: order.buyerEmail, name: order.buyerName ?? undefined },
        applePay: { merchantCountryCode: 'US' },
        googlePay: { merchantCountryCode: 'US', currencyCode: order.currency, testEnv: pi.mode === 'test' },
        returnURL: 'fattixx://stripe-redirect',
        allowsDelayedPaymentMethods: false,
        appearance: { colors: { primary: colors.red, background: colors.pureWhite, componentBackground: colors.ivory, primaryText: colors.ink }, shapes: { borderRadius: 12 } },
      });
      if (init.error) throw new Error(init.error.message);
      const res = await presentPaymentSheet();
      if (res.error) {
        if (res.error.code !== 'Canceled') setErr(res.error.message);
        return;
      }
      await finish();
    } catch (e) {
      setErr((e as Error).message || 'Payment failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmFree() {
    setErr(null); setBusy(true);
    try { await finish(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (isLoading) return <Screen back title="Checkout"><Skeleton style={{ height: 180 }} /><Skeleton style={{ height: 240, marginTop: 14 }} /></Screen>;
  if (isError || !order) return <Screen back title="Checkout"><ErrorState message={(error as Error)?.message ?? 'Order not found.'} onRetry={() => refetch()} /></Screen>;

  const tot = order.totals;
  const backToEvent = () => router.replace({ pathname: '/events/[slug]', params: order.event.key ? { slug: order.event.slug, key: order.event.key } : { slug: order.event.slug } });

  return (
    <Screen back title="Checkout">
      <Txt variant="small">Order <Txt variant="mono">{order.code}</Txt> · tickets go to <Txt variant="bodyStrong" style={{ fontSize: 13 }}>{order.buyerEmail}</Txt></Txt>

      <Card style={{ marginTop: 16, gap: 8 }}>
        <Txt variant="heading">{order.event.title}</Txt>
        <Txt variant="small">{order.event.when}{order.event.venue ? ` · ${order.event.venue}` : ''}</Txt>
        <View style={styles.divider} />
        {order.items.map((i) => <Line key={i.id} label={`${i.quantity} × ${i.name}`} value={formatCents(i.lineCents, order.currency)} />)}
        {order.addons.map((a) => <Line key={`a${a.id}`} label={`${a.quantity} × ${a.name} (add-on)`} value={formatCents(a.lineCents, order.currency)} />)}
        {tot.discountCents ? <Line label="Promo discount" value={`−${formatCents(tot.discountCents, order.currency)}`} color={colors.emerald} /> : null}
        {tot.platformFeeCents ? <Line label="Service fee" value={formatCents(tot.platformFeeCents, order.currency)} muted /> : null}
        {tot.processingFeeCents ? <Line label="Card processing" value={formatCents(tot.processingFeeCents, order.currency)} muted /> : null}
        {tot.taxCents ? <Line label="Tax" value={formatCents(tot.taxCents, order.currency)} muted /> : null}
        <View style={styles.divider} />
        <View style={styles.line}><Txt variant="bodyStrong" style={{ fontSize: 17 }}>Total</Txt><Txt variant="bodyStrong" style={{ fontSize: 17 }}>{formatCents(tot.totalCents, order.currency)}</Txt></View>
        {order.event.ageRestriction ? <Txt variant="caption" color={colors.amber}>{order.event.ageRestriction}+ event. Photo ID required at the door.</Txt> : null}
        <Button title="Change tickets" variant="ghost" size="sm" onPress={backToEvent} />
      </Card>

      <View style={{ marginTop: 16 }}>
        {order.expired ? (
          <Notice tone="error" title="Your reservation expired.">
            <Txt variant="small" color={colors.redBright}>The tickets were released.</Txt>
            <Button title="Start again" variant="outline" size="sm" onPress={backToEvent} style={{ marginTop: 10 }} />
          </Notice>
        ) : tot.totalCents === 0 ? (
          <Card style={{ gap: 12 }}>
            <Txt variant="heading">Free order</Txt>
            <Txt variant="small">No payment needed. Confirm to receive your tickets by email.</Txt>
            {err ? <Notice tone="error">{err}</Notice> : null}
            <Button title="Confirm free tickets" size="lg" full onPress={confirmFree} loading={busy} />
          </Card>
        ) : !config?.stripe ? (
          <Notice tone="error" title="Card payments are not available yet.">The organizer has not finished setting up payments. Please try again later.</Notice>
        ) : (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="heading">Payment</Txt>
              <HoldCountdown expiresAt={order.holdExpiresAt} onExpire={() => refetch()} />
            </View>
            {err ? <Notice tone="error">{err}</Notice> : null}
            <Button title={`Pay ${formatCents(tot.totalCents, order.currency)}`} size="lg" full onPress={pay} loading={busy || sheetLoading} icon={<Lock size={16} color={colors.red} />} />
            <Txt variant="caption" center>Secured by Stripe. Fat Tixx never sees or stores your card number.</Txt>
            {config.stripe.mode === 'test' ? <Txt variant="caption" center color={colors.amber}>Test mode: use card 4242 4242 4242 4242, any future date, any CVC.</Txt> : null}
          </Card>
        )}
      </View>
    </Screen>
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
