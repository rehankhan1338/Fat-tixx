import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts, ivory, red } from '@/theme/tokens';
import { Button, Txt } from '@/components/ui';
import { Wordmark } from '@/components/BrandMark';

type Mode = 'go' | 'host';

/** Copy from the website's hero (components/home/Hero.tsx). */
const COPY = {
  go: { word: 'GO OUT', h: 'Find your next night out.', p: 'Concerts, parties, workshops and more. Discover what’s on near you and get your tickets on Fattixx.', c1: 'Browse events', c2: 'What’s on this weekend' },
  host: { word: 'THROW ONE', h: 'Sell out your next event.', p: 'Build your event page, set up ticket tiers, and check guests in at the door, all on Fattixx.', c1: 'Start hosting', c2: 'How it works' },
} as const;

/**
 * The homepage hero, adapted for a phone: the "I’m going out / I’m hosting" toggle flips the colour scheme
 * (red ↔ yellow), the big outlined word, headline and calls to action. Auto-flips every 5 s until tapped.
 */
export function HomeHero({ onBrowse, onWeekend, onHost, accountLabel, onAccount }: { onBrowse: () => void; onWeekend: () => void; onHost: () => void; accountLabel: string; onAccount: () => void }) {
  const [mode, setMode] = useState<Mode>('go');
  const picked = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;
  const c = COPY[mode];
  const host = mode === 'host';

  useEffect(() => {
    const id = setInterval(() => { if (!picked.current) swap(mode === 'go' ? 'host' : 'go'); }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function swap(m: Mode, byUser = false) {
    if (byUser) picked.current = true;
    if (m === mode) return;
    Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      setMode(m);
      Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
    });
  }

  const fg = host ? colors.red : colors.ivory;
  return (
    <View style={[styles.hero, { backgroundColor: host ? colors.yellow : colors.red }]}>
      <View style={styles.nav}>
        <Wordmark color={fg} />
        <Pressable accessibilityRole="button" onPress={onAccount} hitSlop={8} style={[styles.accountBtn, { borderColor: host ? red(0.25) : ivory(0.25) }]}>
          <Txt style={[styles.accountText, { color: fg }]}>{accountLabel}</Txt>
        </Pressable>
      </View>
      <View style={[styles.toggle, { backgroundColor: host ? red(0.1) : ivory(0.1), borderColor: host ? red(0.16) : ivory(0.14) }]}>
        {(['go', 'host'] as Mode[]).map((m) => {
          const on = m === mode;
          return (
            <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => swap(m, true)}
              style={[styles.toggleBtn, on ? { backgroundColor: host ? colors.red : colors.ivory } : null]}>
              <Txt style={[styles.toggleText, { color: on ? (host ? colors.ivory : colors.red) : fg }]}>{m === 'go' ? 'I’m going out' : 'I’m hosting'}</Txt>
            </Pressable>
          );
        })}
      </View>
      <Animated.View style={{ opacity: fade }}>
        <Txt style={[styles.word, { color: host ? red(0.16) : ivory(0.16) }]} numberOfLines={1} adjustsFontSizeToFit>{c.word}</Txt>
        <Txt style={[styles.h, { color: fg }]}>{c.h}</Txt>
        <Txt style={[styles.p, { color: host ? red(0.8) : ivory(0.85) }]}>{c.p}</Txt>
        <View style={styles.ctas}>
          <Button title={c.c1} variant={host ? 'red' : 'primary'} onPress={host ? onHost : onBrowse} />
          <Button title={c.c2} variant="outline" onPress={host ? onHost : onWeekend} style={{ borderColor: host ? red(0.35) : ivory(0.4) }} />
        </View>
      </Animated.View>
      <Txt style={[styles.corner, { color: host ? red(0.7) : ivory(0.7) }]}>{host ? 'For organizers' : 'Find events near you'}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48 },
  accountBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  accountText: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 18 },
  toggle: { alignSelf: 'center', flexDirection: 'row', padding: 5, borderRadius: 999, borderWidth: 1, marginTop: 14 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  toggleText: { fontFamily: fonts.sansSemi, fontSize: 13, lineHeight: 16 },
  word: { fontFamily: fonts.displayBlack, fontSize: 92, lineHeight: 96, letterSpacing: -4, marginTop: 18, marginBottom: -10 },
  h: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  p: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 360 },
  ctas: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  corner: { marginTop: 22, fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' },
});
