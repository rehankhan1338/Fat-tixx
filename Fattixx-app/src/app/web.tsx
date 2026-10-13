import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { describeDevice } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, EmptyState, Spinner, Txt } from '@/components/ui';
import { setBusy } from '@/lib/loading';
import { API_URL } from '@/lib/config';
import { colors, fonts, red } from '@/theme/tokens';

/**
 * The website inside the app. The first request goes to /app-login with the session token in the
 * Authorization header (sent once, same origin, HTTPS in production); the server answers with a normal
 * browser session cookie and redirects to the requested page. From then on it is the regular website.
 */
export default function WebScreen() {
  const { path, title } = useLocalSearchParams<{ path: string; title?: string }>();
  const { status, getToken } = useAuth();
  const ref = useRef<WebView>(null);
  const [nav, setNav] = useState<WebViewNavigation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Drive the app-wide top progress bar while the page loads.
  useEffect(() => { setBusy('webview', loading && !error); return () => setBusy('webview', false); }, [loading, error]);

  const safePath = /^\/(?!\/)[\w\-./?=&%#]*$/.test(path ?? '') ? path! : '/dashboard';
  const token = getToken();
  const source = useMemo(() => ({
    uri: `${API_URL}/app-login?next=${encodeURIComponent(safePath)}`,
    headers: token ? { Authorization: `Bearer ${token}`, 'X-Fat-Tixx-Device': describeDevice() } : undefined,
  }), [safePath, token]);

  if (status !== 'signed-in' || !token) {
    return (
      <SafeAreaView style={styles.fill}>
        <Header title={title ?? 'Fat Tixx'} />
        <View style={{ padding: 20 }}><EmptyState title="Sign in to continue" action={<Button title="Sign in" onPress={() => router.replace('/login')} />} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      <Header title={nav?.title && !nav.title.startsWith('http') ? nav.title : title ?? 'Fat Tixx'} right={
        <View style={{ flexDirection: 'row' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={!nav?.canGoBack} onPress={() => ref.current?.goBack()} hitSlop={8} style={[styles.iconBtn, !nav?.canGoBack ? { opacity: 0.3 } : null]}><ArrowLeft size={20} color={colors.red} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Forward" disabled={!nav?.canGoForward} onPress={() => ref.current?.goForward()} hitSlop={8} style={[styles.iconBtn, !nav?.canGoForward ? { opacity: 0.3 } : null]}><ArrowRight size={20} color={colors.red} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Reload" onPress={() => ref.current?.reload()} hitSlop={8} style={styles.iconBtn}><RotateCw size={18} color={colors.red} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open in browser" onPress={() => WebBrowser.openBrowserAsync(nav?.url ?? `${API_URL}${safePath}`)} hitSlop={8} style={styles.iconBtn}><ExternalLink size={18} color={colors.red} /></Pressable>
        </View>
      } />
      {error ? (
        <View style={{ padding: 20 }}><EmptyState title="Could not load the page" description={error} action={<Button title="Try again" variant="outline" onPress={() => { setError(null); ref.current?.reload(); }} />} /></View>
      ) : (
        <WebView
          ref={ref}
          source={source}
          style={styles.fill}
          originWhitelist={[`${API_URL}*`, 'https://*.stripe.com*', 'https://js.stripe.com*']}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          onNavigationStateChange={setNav}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e) => setError(e.nativeEvent.description || 'The page could not be loaded.')}
          onShouldStartLoadWithRequest={(r) => {
            // Keep the web view on the Fat Tixx site (and Stripe's checkout frames); hand every other link to the system browser.
            if (r.url.startsWith(API_URL) || r.url.includes('stripe.com') || r.url.startsWith('about:')) return true;
            WebBrowser.openBrowserAsync(r.url).catch(() => {});
            return false;
          }}
        />
      )}
      {loading && !error ? <View style={styles.loading}><Spinner size={22} /></View> : null}
    </SafeAreaView>
  );
}

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={styles.iconBtn}><X size={22} color={colors.red} /></Pressable>
      <Txt numberOfLines={1} style={styles.title}>{title}</Txt>
      {right ?? <View style={{ width: 44 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.pureWhite },
  header: { flexDirection: 'row', alignItems: 'center', height: 50, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: red(0.15), backgroundColor: colors.ivory },
  iconBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.sansSemi, fontSize: 15, color: colors.red },
  loading: { position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: colors.pureWhite, borderRadius: 999, padding: 8, elevation: 3 },
});
