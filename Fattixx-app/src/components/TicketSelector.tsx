import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Minus, Plus, Tag as TagIcon } from 'lucide-react-native';
import { api, ApiError } from '@/api/client';
import type { CheckoutRequest, CheckoutResponse, EventDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { rememberOrder } from '@/auth/secure';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { formatCents } from '@/lib/format';
import { colors, fonts, radius, red } from '@/theme/tokens';

/**
 * Ticket picker + buyer details, the app version of the website's TicketSelector. Reserves the tickets through
 * POST /checkout and moves on to the payment screen. Rules (limits, availability, access codes) are enforced
 * again on the server; the UI only keeps people from picking impossible quantities.
 */
export function TicketSelector({ detail, queueToken }: { detail: EventDetail; queueToken: string | null }) {
  const { account } = useAuth();
  // When the picker opened: the server rejects submissions faster than a person could fill it in (bot check).
  const [startedAt] = useState(() => Date.now());
  const [qty, setQty] = useState<Record<number, number>>({});
  const [addonQty, setAddonQty] = useState<Record<number, number>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [name, setName] = useState(account?.user.name ?? '');
  const [email, setEmail] = useState(account?.user.email ?? '');
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [promo, setPromo] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  const { event, tickets, addons, questions } = detail;
  const lines = tickets.filter((t) => (qty[t.id] ?? 0) > 0);
  const count = lines.reduce((n, t) => n + qty[t.id], 0);
  const estimate = useMemo(
    () => lines.reduce((n, t) => n + t.allInCents * qty[t.id], 0) + addons.reduce((n, a) => n + a.allInCents * (addonQty[a.id] ?? 0), 0),
    [lines, qty, addons, addonQty],
  );

  function bump(t: EventDetail['tickets'][number], delta: number) {
    setQty((cur) => {
      const now = cur[t.id] ?? 0;
      const cap = Math.min(t.max, t.available);
      let next = now + delta;
      if (next > 0 && next < t.min) next = delta > 0 ? t.min : 0;
      next = Math.max(0, Math.min(cap, next));
      return { ...cur, [t.id]: next };
    });
  }

  async function submit() {
    setError(null); setField(null);
    if (count === 0) return setError('Choose at least one ticket.');
    if (event.ageRestriction && !ageOk) return setError(`Please confirm everyone attending is ${event.ageRestriction} or older.`);
    for (const qn of questions) {
      const a = (answers[qn.id] ?? '').trim();
      if (qn.required && !a) return setError(qn.kind === 'checkbox' ? `Please confirm “${qn.label}”.` : `Please answer “${qn.label}”.`);
    }
    setBusy(true);
    const body: CheckoutRequest = {
      eventSlug: event.slug,
      lines: lines.map((t) => ({ ticketTypeId: t.id, quantity: qty[t.id] })),
      addons: addons.filter((a) => (addonQty[a.id] ?? 0) > 0).map((a) => ({ addonId: a.id, quantity: addonQty[a.id] })),
      answers: questions.map((qn) => ({ questionId: qn.id, answer: (answers[qn.id] ?? '').trim() })).filter((a) => a.answer),
      email: email.trim(), name: name.trim(), phone: phone.trim() || undefined, accessCode: detail.accessCode || undefined, promoCode: promo.trim() || undefined,
      marketing, sms: sms && !!phone.trim(), startedAt,
    };
    try {
      const r = await api<CheckoutResponse>('/checkout', { method: 'POST', body, headers: queueToken ? { 'X-Fx-Queue-Token': queueToken } : undefined });
      await rememberOrder({ code: r.code, t: r.accessToken, title: event.title, when: detail.event.dates[0]?.when ?? '', at: Date.now() });
      router.push({ pathname: '/checkout/[code]', params: { code: r.code, t: r.accessToken } });
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      setField(err.field ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {tickets.map((t) => {
        const n = qty[t.id] ?? 0;
        const soldOut = !t.onSale && t.reason === 'sold_out';
        const disabled = !t.onSale;
        return (
          <View key={t.id} style={[styles.ticket, disabled ? styles.ticketOff : null]}>
            <View style={styles.ticketText}>
              <View style={styles.ticketHead}>
                <Txt variant="bodyStrong" style={{ flexShrink: 1 }}>{t.name}</Txt>
                {t.presale ? <Txt variant="caption" color={colors.emerald}>Presale</Txt> : null}
                {t.kind === 'table' ? <Txt variant="caption">Table of {t.seats}</Txt> : null}
              </View>
              {t.dayLabel ? <Txt variant="caption">{t.dayLabel}</Txt> : null}
              {t.description ? <Txt variant="small">{t.description}</Txt> : null}
              <Txt variant="small" style={{ marginTop: 2 }}>
                <Txt variant="bodyStrong">{t.allInCents === 0 ? 'Free' : formatCents(t.allInCents, event.currency)}</Txt>
                {t.allInCents > 0 && t.allInCents !== t.priceCents ? <Txt variant="caption">  incl. fees</Txt> : null}
              </Txt>
              {soldOut ? <Txt variant="caption" color={colors.redBright}>Sold out</Txt>
                : t.reason === 'not_yet' ? <Txt variant="caption">On sale {t.salesStart}</Txt>
                : t.reason === 'ended' ? <Txt variant="caption">Sales ended</Txt>
                : t.available <= 10 ? <Txt variant="caption" color={colors.amber}>Only {t.available} left</Txt> : null}
            </View>
            <Stepper value={n} onChange={(d) => bump(t, d)} disabled={disabled} max={Math.min(t.max, t.available)} />
          </View>
        );
      })}

      {addons.length && count > 0 ? (
        <View style={{ gap: 10 }}>
          <Txt variant="eyebrow">Add-ons</Txt>
          {addons.map((a) => (
            <View key={a.id} style={styles.ticket}>
              <View style={styles.ticketText}>
                <Txt variant="bodyStrong">{a.name}</Txt>
                {a.description ? <Txt variant="small">{a.description}</Txt> : null}
                <Txt variant="bodyStrong">{formatCents(a.allInCents, event.currency)}</Txt>
                {a.available === 0 ? <Txt variant="caption" color={colors.redBright}>Sold out</Txt> : null}
              </View>
              <Stepper value={addonQty[a.id] ?? 0} disabled={a.available === 0} max={Math.min(a.max, a.available ?? a.max)} onChange={(d) => setAddonQty((c) => ({ ...c, [a.id]: Math.max(0, Math.min(Math.min(a.max, a.available ?? a.max), (c[a.id] ?? 0) + d)) }))} />
            </View>
          ))}
        </View>
      ) : null}

      {count > 0 ? (
        <View style={{ gap: 14 }}>
          <View style={styles.divider} />
          <Txt variant="eyebrow">Your details</Txt>
          <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" required error={field === 'name' ? error : null} />
          <Field label="Email for your tickets" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" required error={field === 'email' ? error : null} />
          <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
          {detail.smsEnabled ? <Toggle label="Text me my ticket link and a reminder" hint="Uses the phone number above. Message rates may apply." value={sms} onChange={setSms} /> : null}
          {questions.map((qn) => qn.kind === 'checkbox' ? (
            <Toggle key={qn.id} label={qn.label + (qn.required ? ' *' : '')} value={answers[qn.id] === 'Yes'} onChange={(v) => setAnswers((c) => ({ ...c, [qn.id]: v ? 'Yes' : '' }))} />
          ) : qn.kind === 'select' ? (
            <View key={qn.id} style={{ gap: 6 }}>
              <Txt variant="small" style={{ fontFamily: fonts.sansMedium, color: colors.red }}>{qn.label}{qn.required ? ' *' : ''}</Txt>
              <View style={styles.options}>
                {qn.options.map((o) => {
                  const on = answers[qn.id] === o;
                  return <Pressable key={o} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setAnswers((c) => ({ ...c, [qn.id]: on ? '' : o }))} style={[styles.option, on ? styles.optionOn : null]}><Txt variant="small" color={on ? colors.ivory : colors.red}>{o}</Txt></Pressable>;
                })}
              </View>
            </View>
          ) : (
            <Field key={qn.id} label={qn.label} required={qn.required} value={answers[qn.id] ?? ''} onChangeText={(v) => setAnswers((c) => ({ ...c, [qn.id]: v }))} multiline={qn.kind === 'textarea'} maxLength={1000} />
          ))}
          {detail.hasPromo ? <Field label="Promo code (optional)" value={promo} onChangeText={(v) => setPromo(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={40} hint="The discount is applied on the next step." right={<TagIcon size={16} color={red(0.5)} />} /> : null}
          <Toggle label="Email me about future events from this organizer" value={marketing} onChange={setMarketing} />
          {event.ageRestriction ? <Toggle label={`Everyone attending is ${event.ageRestriction}+ and will bring photo ID`} value={ageOk} onChange={setAgeOk} /> : null}
        </View>
      ) : null}

      {error && !field ? <Notice tone="error">{error}</Notice> : null}

      <View style={styles.summary}>
        <View>
          <Txt variant="caption">{count ? `${count} ticket${count === 1 ? '' : 's'}` : 'No tickets selected'}</Txt>
          <Txt variant="title">{estimate === 0 && count ? 'Free' : formatCents(estimate, event.currency)}</Txt>
          {count && event.feeMode === 'buyer_pays' && estimate > 0 ? <Txt variant="caption">+ card processing at checkout</Txt> : null}
        </View>
        <Button title={busy ? 'Reserving…' : 'Continue'} size="lg" onPress={submit} loading={busy} disabled={count === 0} />
      </View>
    </View>
  );
}

function Stepper({ value, onChange, disabled, max }: { value: number; onChange: (delta: number) => void; disabled?: boolean; max: number }) {
  return (
    <View style={[styles.stepper, disabled ? { opacity: 0.4 } : null]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Remove one" disabled={disabled || value === 0} onPress={() => onChange(-1)} hitSlop={6} style={styles.stepBtn}><Minus size={16} color={colors.red} /></Pressable>
      <Txt variant="bodyStrong" style={styles.stepValue}>{value}</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel="Add one" disabled={disabled || value >= max} onPress={() => onChange(1)} hitSlop={6} style={styles.stepBtn}><Plus size={16} color={colors.red} /></Pressable>
    </View>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Txt variant="small" style={{ color: colors.red }}>{label}</Txt>
        {hint ? <Txt variant="caption">{hint}</Txt> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.red, false: red(0.2) }} thumbColor={colors.pureWhite} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  ticketOff: { opacity: 0.7 },
  ticketText: { flex: 1, gap: 2 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: red(0.2) },
  stepBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 22, textAlign: 'center' },
  divider: { height: 1, backgroundColor: red(0.1) },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: red(0.2), backgroundColor: colors.pureWhite },
  optionOn: { backgroundColor: colors.red, borderColor: colors.red },
  summary: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
