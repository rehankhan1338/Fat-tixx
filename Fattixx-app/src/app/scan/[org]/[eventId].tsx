import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, CloudOff, CloudUpload, Flashlight, FlashlightOff, Keyboard, RefreshCw } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import type { ScanResult } from '@/api/types';
import { Button, Spinner, Txt } from '@/components/ui';
import { isNetworkError, useOfflineScanner, type Counts } from '@/scanner/offline';
import { localCounts } from '@/scanner/store';
import { setBusy as setGlobalBusy } from '@/lib/loading';
import { colors, fonts, radius } from '@/theme/tokens';

/**
 * Door scanner. Online, the camera reads the signed QR and the server validates signature, status and
 * one-time use. Offline (no signal, or the server cannot be reached), the scan is checked against the
 * ticket list stored on the phone and the admission is queued for upload; see scanner/offline.ts.
 * The same code is ignored for a few seconds so a ticket held up to the camera is not sent twice.
 * Haptics + colour make the result readable at arm's length in a dark doorway.
 */
export default function ScannerScreen() {
  const { org, eventId, title } = useLocalSearchParams<{ org: string; eventId: string; title?: string }>();
  const eventNo = Number(eventId);
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  // The latest counts are also kept in a ref so async scan handlers read the current value, not a stale closure.
  const countsRef = useRef<Counts | null>(null);
  const updateCounts = useCallback((c: Counts) => { countsRef.current = c; setCounts(c); }, []);
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offline = useOfflineScanner(org, eventNo, updateCounts);
  // Offline list downloads, uploads of queued check-ins and live scans all run the app-wide top progress bar.
  useEffect(() => { setGlobalBusy('scanner', busy || offline.downloading || offline.syncing); return () => setGlobalBusy('scanner', false); }, [busy, offline.downloading, offline.syncing]);

  // Live counts when reachable; otherwise the counts implied by the stored list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ counts: Counts }>(`/scan/${org}/${eventNo}`, { timeoutMs: 8000 });
        if (!cancelled) updateCounts(r.counts);
      } catch {
        const local = await localCounts(eventNo);
        if (!cancelled && local && !countsRef.current) updateCounts(local);
      }
    })();
    return () => { cancelled = true; };
  }, [org, eventNo, updateCounts]);

  const apply = useCallback((r: ScanResult) => {
    setResult(r);
    updateCounts(r.counts);
    const good = r.result === 'valid' || r.result === 'manual' || r.result === 'override';
    const kind = good ? Haptics.NotificationFeedbackType.Success : r.result === 'already_used' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error;
    Haptics.notificationAsync(kind).catch(() => {});
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), 4000);
  }, [updateCounts]);

  const submit = useCallback(async (payload: string) => {
    if (busy) return;
    const now = Date.now();
    if (lastRef.current.value === payload && now - lastRef.current.at < 3000) return;
    lastRef.current = { value: payload, at: now };
    setBusy(true);
    try {
      if (!offline.online) {
        apply(await offline.offlineCheck({ payload }, 'valid', countsRef.current));
        return;
      }
      try {
        apply(await api<ScanResult>(`/scan/${org}/${eventNo}`, { method: 'POST', body: { payload }, timeoutMs: 8000 }));
      } catch (e) {
        if (isNetworkError(e)) {
          offline.markUnreachable();
          apply(await offline.offlineCheck({ payload }, 'valid', countsRef.current));
        } else {
          apply({ result: 'invalid', message: (e as Error).message, counts: countsRef.current ?? { total: 0, used: 0 } });
        }
      }
    } finally {
      setBusy(false);
    }
  }, [busy, org, eventNo, offline, apply]);

  const onScanned = useCallback((r: BarcodeScanningResult) => { if (r.data) void submit(r.data.trim()); }, [submit]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!permission) return <View style={styles.screen} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.screen, { padding: 24, justifyContent: 'center', gap: 14 }]}>
        <Txt variant="title" color="#fff">Camera access needed</Txt>
        <Txt variant="body" color="#D4D4D8">Fat Tixx uses the camera only to read ticket QR codes at the door.</Txt>
        <Button title="Allow camera" onPress={() => requestPermission()} />
        <Button title="Enter codes by hand instead" variant="outline" onPress={() => setManual(true)} style={{ borderColor: 'rgba(255,255,255,0.4)' }} />
        <Button title="Back" variant="ghost" onPress={() => router.back()} />
        <OfflineStrip o={offline} />
        {manual ? <ManualEntry code={code} setCode={setCode} onSubmit={() => code && submit(code.trim().toUpperCase())} busy={busy} /> : null}
        {result ? <ResultBanner r={result} /> : null}
      </SafeAreaView>
    );
  }

  const tone = result ? toneFor(result.result) : null;
  return (
    <View style={styles.screen}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy || result ? undefined : onScanned} />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={{ gap: 8 }}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}><ArrowLeft size={22} color="#fff" /></Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Txt style={styles.title} numberOfLines={1}>{title ?? 'Scanner'}</Txt>
              {counts ? <Txt style={styles.counts}>{counts.used} / {counts.total} checked in</Txt> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Torch off' : 'Torch on'} onPress={() => setTorch((v) => !v)} hitSlop={10} style={styles.iconBtn}>{torch ? <FlashlightOff size={22} color="#fff" /> : <Flashlight size={22} color="#fff" />}</Pressable>
          </View>
          <OfflineStrip o={offline} />
        </View>
        <View style={[styles.frame, tone ? { borderColor: tone.bg } : null]} />
        <View style={styles.bottom}>
          {result ? <ResultBanner r={result} /> : <Txt style={styles.hint}>{busy ? 'Checking…' : offline.online ? 'Point the camera at the ticket QR code' : 'Offline · checking against the list on this phone'}</Txt>}
          {manual ? <ManualEntry code={code} setCode={setCode} onSubmit={() => code && submit(code.trim().toUpperCase())} busy={busy} /> : (
            <Pressable accessibilityRole="button" onPress={() => setManual(true)} style={styles.manualBtn}><Keyboard size={16} color="#fff" /><Txt style={styles.manualText}>Type a ticket code</Txt></Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Connection + offline-list status. Hidden while everything is normal (online, nothing queued, list stored),
 * so door staff only see it when it matters.
 */
function OfflineStrip({ o }: { o: ReturnType<typeof useOfflineScanner> }) {
  const listedAt = o.list ? new Date(o.list.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const listText = o.list ? `list from ${listedAt} · ${o.list.ticketCount.toLocaleString()} tickets` : 'no ticket list on this phone';
  if (o.notice) return <View style={[styles.strip, { backgroundColor: 'rgba(22,163,74,0.9)' }]}><CloudUpload size={16} color="#fff" /><Txt style={styles.stripText}>{o.notice}</Txt></View>;
  if (!o.online) {
    return (
      <View style={[styles.strip, { backgroundColor: o.list ? 'rgba(217,119,6,0.92)' : 'rgba(220,38,38,0.92)' }]}>
        <CloudOff size={16} color="#fff" />
        <Txt style={styles.stripText}>Offline · {listText}{o.queued ? ` · ${o.queued} to upload` : ''}</Txt>
      </View>
    );
  }
  if (o.downloading && !o.list) return <View style={styles.strip}><Spinner size={16} color="#fff" track="rgba(255,255,255,0.25)" /><Txt style={styles.stripText}>Downloading ticket list for offline use…</Txt></View>;
  if (o.queued || o.syncing) {
    return (
      <Pressable accessibilityRole="button" onPress={() => void o.sync()} disabled={o.syncing} style={styles.strip}>
        {o.syncing ? <Spinner size={16} color="#fff" track="rgba(255,255,255,0.25)" /> : <CloudUpload size={16} color="#fff" />}
        <Txt style={styles.stripText}>{o.syncing ? 'Uploading offline check-ins…' : `${o.queued} offline check-in${o.queued === 1 ? '' : 's'} to upload · tap to upload now`}</Txt>
      </Pressable>
    );
  }
  if (!o.list) {
    return (
      <Pressable accessibilityRole="button" onPress={() => void o.sync()} style={styles.strip}>
        <RefreshCw size={16} color="#fff" />
        <Txt style={styles.stripText}>No offline list yet · tap to download</Txt>
      </Pressable>
    );
  }
  return null;
}

function toneFor(result: ScanResult['result']) {
  if (result === 'valid' || result === 'manual' || result === 'override' || result === 'undo') return { bg: '#16A34A', label: result === 'valid' ? 'ADMIT' : result.toUpperCase() };
  if (result === 'already_used') return { bg: '#F59E0B', label: 'ALREADY SCANNED' };
  if (result === 'wrong_day') return { bg: '#F59E0B', label: 'WRONG DAY' };
  if (result === 'wrong_event') return { bg: '#DC2626', label: 'WRONG EVENT' };
  return { bg: '#DC2626', label: result.replace(/_/g, ' ').toUpperCase() };
}

function ResultBanner({ r }: { r: ScanResult }) {
  const t = toneFor(r.result);
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityLiveRegion="assertive">
      <Txt style={styles.bannerTitle}>{t.label}</Txt>
      {r.ticket ? <Txt style={styles.bannerName}>{r.ticket.attendeeName ?? r.ticket.buyerEmail} · {r.ticket.ticketType}{r.ticket.seatLabel ? ` · ${r.ticket.seatLabel}` : ''}{r.ticket.dayLabel ? ` · ${r.ticket.dayLabel}` : ''}</Txt> : null}
      <Txt style={styles.bannerMsg}>{r.message}</Txt>
      {r.ticket?.addons ? <Txt style={styles.bannerMsg}>Add-ons: {r.ticket.addons}</Txt> : null}
      {r.ageRestriction && (r.result === 'valid' || r.result === 'manual') ? <Txt style={styles.bannerAge}>{r.ageRestriction}+ event — check photo ID</Txt> : null}
    </View>
  );
}

function ManualEntry({ code, setCode, onSubmit, busy }: { code: string; setCode: (v: string) => void; onSubmit: () => void; busy: boolean }) {
  return (
    <View style={styles.manual}>
      <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="12-character ticket code" placeholderTextColor="#A1A1AA" autoCapitalize="characters" autoCorrect={false} maxLength={12} returnKeyType="go" onSubmitEditing={onSubmit} style={styles.input} accessibilityLabel="Ticket code" />
      <Button title="Check" size="md" onPress={onSubmit} loading={busy} disabled={code.length < 12} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 6 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.displayBold, fontSize: 17, color: '#fff' },
  counts: { fontFamily: fonts.sansMedium, fontSize: 12, color: '#E4E4E7' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', maxWidth: '92%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' },
  stripText: { flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 13, color: '#fff' },
  frame: { alignSelf: 'center', width: 260, height: 260, borderRadius: 28, borderWidth: 3, borderColor: 'rgba(255,255,255,0.7)' },
  bottom: { padding: 16, gap: 12 },
  hint: { textAlign: 'center', fontFamily: fonts.sansMedium, fontSize: 14, color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  banner: { borderRadius: radius.xl, padding: 16, gap: 4 },
  bannerTitle: { fontFamily: fonts.displayBlack, fontSize: 26, letterSpacing: -0.5, color: '#fff' },
  bannerName: { fontFamily: fonts.sansSemi, fontSize: 16, color: '#fff' },
  bannerMsg: { fontFamily: fonts.sans, fontSize: 13, color: 'rgba(255,255,255,0.92)' },
  bannerAge: { marginTop: 6, fontFamily: fonts.sansBold, fontSize: 13, color: colors.ink, backgroundColor: colors.yellow, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  manualBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  manualText: { fontFamily: fonts.sansMedium, fontSize: 14, color: '#fff' },
  manual: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 46, borderRadius: 999, paddingHorizontal: 16, backgroundColor: '#fff', fontFamily: 'monospace', fontSize: 16, letterSpacing: 2, color: '#18181B' },
});
