import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { LogOut, Smartphone, Globe, ShieldCheck } from 'lucide-react-native';
import { api } from '@/api/client';
import { useConfig, useSessions } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Notice, Screen, Txt } from '@/components/ui';
import { API_URL, APP_VERSION } from '@/lib/config';
import { colors, red } from '@/theme/tokens';

/**
 * The signed-in person: who they are, which organisations they work for and in what role, where they
 * are signed in, and the legal pages (opened in the system browser). Organisation settings, team,
 * payouts and the rest of the dashboard are website-only and are not linked from here.
 */
export default function AccountScreen() {
  const { account, signOut, refresh } = useAuth();
  const { data: config } = useConfig();
  const { data: sessions, refetch } = useSessions(!!account);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try { const r = await api<{ message: string }>('/auth/resend-verification', { method: 'POST' }); setMsg(r.message); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    await api('/auth/sessions', { method: 'DELETE', body: { sessionId: id } }).catch(() => {});
    refetch();
  }
  function confirmSignOut() {
    Alert.alert('Sign out', 'This signs out this device. Ticket lists saved for offline scanning are removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
    ]);
  }

  const legal = config?.legal ?? { terms: `${API_URL}/terms`, privacy: `${API_URL}/privacy`, refunds: `${API_URL}/refunds`, ticketing: `${API_URL}/ticketing-terms` };

  return (
    <Screen title="Account" onRefresh={() => { refresh(); refetch(); }} refreshing={false}>
      {account ? (
        <>
          <Card style={{ gap: 4 }}>
            <Txt variant="caption">Signed in as</Txt>
            <Txt variant="title">{account.user.name}</Txt>
            <Txt variant="small">{account.user.email}</Txt>
          </Card>
          {!account.user.emailVerified ? (
            <Notice tone="warning" title="Confirm your email address">
              <Txt variant="small" color={colors.amber}>Check your inbox for the confirmation link.</Txt>
              {msg ? <Txt variant="small" color={colors.amber} style={{ marginTop: 4 }}>{msg}</Txt> : null}
              <Button title="Resend confirmation link" variant="outline" size="sm" onPress={resend} loading={busy} style={{ marginTop: 8 }} />
            </Notice>
          ) : null}
          {account.memberships.length ? (
            <View style={{ gap: 8, marginTop: 16 }}>
              <Txt variant="eyebrow">Organizations</Txt>
              {account.memberships.map((m) => (
                <View key={m.slug} style={styles.row}>
                  <View style={{ flex: 1 }}><Txt variant="bodyStrong">{m.name}</Txt><Txt variant="caption">{m.role === 'org_admin' ? 'Organization admin' : m.role === 'organizer' ? 'Organizer' : 'Staff / scanner'}{m.suspended ? ' · suspended' : ''}</Txt></View>
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ gap: 8, marginTop: 16 }}>
            <Txt variant="eyebrow">Where you&rsquo;re signed in</Txt>
            {(sessions?.sessions ?? []).map((s) => (
              <View key={s.id} style={styles.row}>
                {s.kind === 'app' ? <Smartphone size={18} color={red(0.6)} /> : <Globe size={18} color={red(0.6)} />}
                <View style={{ flex: 1 }}>
                  <Txt variant="small" style={{ color: colors.red }} numberOfLines={1}>{s.device || (s.kind === 'app' ? 'Fat Tixx app' : 'Web browser')}{s.current ? ' · this device' : ''}</Txt>
                  <Txt variant="caption">Last active {new Date(s.lastSeenAt).toLocaleString()}</Txt>
                </View>
                {!s.current ? <Button title="Sign out" variant="ghost" size="sm" onPress={() => revoke(s.id)} /> : null}
              </View>
            ))}
          </View>
          <Button title="Sign out" variant="outline" full onPress={confirmSignOut} icon={<LogOut size={16} color={colors.red} />} style={{ marginTop: 20 }} />
        </>
      ) : null}

      <View style={{ gap: 8, marginTop: 28 }}>
        <Txt variant="eyebrow">Legal & help</Txt>
        <Card flat style={{ gap: 2, padding: 6 }}>
          {[['Terms of service', legal.terms], ['Privacy policy', legal.privacy], ['Refund policy', legal.refunds], ['Ticketing terms', legal.ticketing]].map(([label, url]) => (
            <Pressable key={label} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(url)} style={styles.link}><Txt variant="body">{label}</Txt></Pressable>
          ))}
        </Card>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <ShieldCheck size={14} color={red(0.5)} />
          <Txt variant="caption">Fat Tixx {APP_VERSION} · {config?.supportEmail ?? 'support@fattixx.com'}</Txt>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: red(0.12), backgroundColor: colors.pureWhite },
  link: { paddingHorizontal: 12, paddingVertical: 12 },
});
