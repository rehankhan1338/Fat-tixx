import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Search } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEvents } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { EventCard } from '@/components/EventCard';
import { CategoryPills } from '@/components/home/CategoryPills';
import { FeaturedStrip } from '@/components/home/FeaturedStrip';
import { HomeHero } from '@/components/home/HomeHero';
import { Button, ErrorState, Pill, ScreenLoader, Txt } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { inWindow, listUpcoming, type ListedEvent, type WhenFilter } from '@/lib/format';
import { colors, fonts, GUTTER, red } from '@/theme/tokens';

const WHEN: { label: string; v: WhenFilter }[] = [{ label: 'This weekend', v: 'weekend' }, { label: 'Next 7 days', v: '7' }, { label: 'Next 30 days', v: '30' }];
const PAGE = 12;

/** Discover: hero, categories, featured strip and the upcoming-events grid with the website's filters. */
export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { data, isLoading, isError, error, refetch, isRefetching } = useEvents();
  const { status, account } = useAuth();
  const listRef = useRef<FlatList<ListedEvent>>(null);
  const [q, setQ] = useState('');
  const [when, setWhen] = useState<WhenFilter>('');
  const [free, setFree] = useState(false);
  const [cat, setCat] = useState('');
  const [shown, setShown] = useState(PAGE);

  const upcoming = useMemo(() => listUpcoming(data?.events ?? []), [data]);
  const featured = useMemo(() => {
    const withPhoto = upcoming.filter((e) => e.imageUrl);
    const f = withPhoto.filter((e) => e.featured);
    return f.length >= 4 ? f : withPhoto.slice(0, 8);
  }, [upcoming]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return upcoming.filter((e) => {
      if (needle && `${e.title} ${e.organizerName} ${e.venue} ${e.city} ${e.category}`.toLowerCase().indexOf(needle) < 0) return false;
      if (free && e.price != null) return false;
      if (cat && e.category !== cat) return false;
      return inWindow(e, when);
    });
  }, [upcoming, q, free, cat, when]);

  const columnGap = 14;
  const cardWidth = (width - GUTTER * 2 - columnGap) / 2;
  const scrollToEvents = useCallback(() => listRef.current?.scrollToOffset({ offset: 560, animated: true }), []);
  const accountLabel = status === 'signed-in' ? (account?.user.roles.length ? 'Admin' : 'My account') : 'Sign in';
  const onAccount = () => router.push(status === 'signed-in' ? '/account' : '/login');
  const onHost = () => WebBrowser.openBrowserAsync(`${API_URL}/sell`).catch(() => {});

  const header = (
    <View>
      <HomeHero onBrowse={scrollToEvents} onWeekend={() => { setWhen('weekend'); scrollToEvents(); }} onHost={onHost} accountLabel={accountLabel} onAccount={onAccount} />
      <View style={styles.section}>
        <Txt variant="eyebrow" style={{ paddingHorizontal: GUTTER }}>Browse by category</Txt>
        <View style={{ marginTop: 10 }}><CategoryPills value={cat} onChange={(c) => { setCat(c); setShown(PAGE); scrollToEvents(); }} /></View>
      </View>
      <FeaturedStrip events={featured} />
      <View style={[styles.section, { paddingHorizontal: GUTTER }]}>
        <Txt variant="eyebrow">What’s on</Txt>
        <Txt variant="display" style={{ marginTop: 6 }}>Upcoming events</Txt>
        <View style={styles.search}>
          <Search size={16} color={red(0.6)} />
          <TextInput value={q} onChangeText={(t) => { setQ(t); setShown(PAGE); }} placeholder="Search events" placeholderTextColor={red(0.55)} autoCorrect={false} returnKeyType="search" accessibilityLabel="Search events" style={styles.searchInput} />
        </View>
        <View style={styles.filters}>
          {WHEN.map((w) => <Pill key={w.v} label={w.label} active={when === w.v} onPress={() => { setWhen(when === w.v ? '' : w.v); setShown(PAGE); }} />)}
          <Pill label="Free" active={free} onPress={() => { setFree(!free); setShown(PAGE); }} />
          {cat ? <Pill label={`${cat} ×`} active onPress={() => setCat('')} /> : null}
        </View>
        <Txt variant="caption" style={{ marginTop: 10 }} accessibilityLiveRegion="polite">{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</Txt>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView edges={['top']} style={styles.fill}>
        <ScreenLoader label="Finding events near you…" />
      </SafeAreaView>
    );
  }
  if (isError) {
    return <SafeAreaView edges={['top']} style={[styles.fill, { padding: GUTTER, justifyContent: 'center' }]}><ErrorState message={(error as Error).message} onRetry={() => refetch()} /></SafeAreaView>;
  }

  return (
    <SafeAreaView edges={['top']} style={styles.fill}>
      <FlatList
        ref={listRef}
        data={filtered.slice(0, shown)}
        keyExtractor={(e) => String(e.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: columnGap, paddingHorizontal: GUTTER }}
        contentContainerStyle={{ gap: 30, paddingBottom: 40 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => <EventCard e={item} width={cardWidth} />}
        ListEmptyComponent={
          <View style={[styles.empty, { marginHorizontal: GUTTER }]}>
            {upcoming.length === 0 ? <Txt variant="body" center>No events found. Check back soon.</Txt> : (
              <>
                <Txt variant="body" center>No events match those filters yet.</Txt>
                <Button title="Clear filters" variant="outline" size="sm" onPress={() => { setQ(''); setWhen(''); setFree(false); setCat(''); }} style={{ marginTop: 12 }} />
              </>
            )}
          </View>
        }
        ListFooterComponent={
          <View style={{ alignItems: 'center', gap: 16, paddingHorizontal: GUTTER }}>
            {filtered.length > shown ? <Button title="Show more events" variant="outline" onPress={() => setShown((n) => n + PAGE)} /> : null}
            <Txt variant="caption" center>All prices shown include mandatory fees. Taxes shown at checkout where applicable.</Txt>
          </View>
        }
        onRefresh={refetch}
        refreshing={isRefetching}
        removeClippedSubviews
        initialNumToRender={6}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ivory },
  section: { marginTop: 28 },
  search: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: red(0.14), backgroundColor: colors.pureWhite },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.ink, paddingVertical: 10 },
  filters: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { padding: 32, borderRadius: 20, borderWidth: 1, borderColor: red(0.14), alignItems: 'center' },
});
