import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { openEvent } from '@/components/EventCard';
import { Poster, Txt } from '@/components/ui';
import { priceText, whenText, type ListedEvent } from '@/lib/format';
import { colors, fonts, GUTTER } from '@/theme/tokens';

/** Horizontal strip of featured events (the drifting photo row on the website, swipeable here). */
export function FeaturedStrip({ events }: { events: ListedEvent[] }) {
  if (!events.length) return null;
  return (
    <View style={styles.wrap}>
      <Txt variant="eyebrow" style={styles.eyebrow}>Featured</Txt>
      <FlatList
        horizontal
        data={events}
        keyExtractor={(e) => String(e.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        snapToInterval={CARD_W + 12}
        decelerationRate="fast"
        renderItem={({ item: e }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={e.title} onPress={() => openEvent(e)} disabled={!e.slug} style={({ pressed }) => [styles.card, pressed ? { opacity: 0.9 } : null]}>
            <Poster imageUrl={e.imageUrl} variant={e.v} ratio={3 / 4} rounded={18} />
            <View style={styles.caption}>
              <Txt style={styles.when} numberOfLines={1}>{whenText(e.dt)}</Txt>
              <Txt style={styles.title} numberOfLines={2}>{e.title}</Txt>
              <Txt style={styles.price}>{priceText(e)} · {e.city}</Txt>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const CARD_W = 220;

const styles = StyleSheet.create({
  wrap: { marginTop: 28 },
  eyebrow: { paddingHorizontal: GUTTER, marginBottom: 12 },
  list: { paddingHorizontal: GUTTER, gap: 12 },
  card: { width: CARD_W },
  caption: { marginTop: 10, gap: 3 },
  when: { fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.redSecond },
  title: { fontFamily: fonts.display, fontSize: 17, lineHeight: 20, letterSpacing: -0.3, color: colors.red },
  price: { fontFamily: fonts.sansMedium, fontSize: 13, color: 'rgba(168,18,26,0.78)' },
});
