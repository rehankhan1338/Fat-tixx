import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Poster, Tag, Txt } from '@/components/ui';
import { priceText, whenText, type ListedEvent } from '@/lib/format';
import { colors, fonts, red } from '@/theme/tokens';

export function openEvent(e: { slug: string | null; key: string | null }) {
  if (!e.slug) return;
  router.push({ pathname: '/events/[slug]', params: e.key ? { slug: e.slug, key: e.key } : { slug: e.slug } });
}

/** Grid card from the homepage: poster, date eyebrow with tag, title, venue, price and organiser. */
export const EventCard = memo(function EventCard({ e, width }: { e: ListedEvent; width: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}, ${whenText(e.dt)}, ${priceText(e)}`} onPress={() => openEvent(e)} disabled={!e.slug}
      style={({ pressed }) => [styles.card, { width }, pressed ? { opacity: 0.9 } : null]}>
      <Poster imageUrl={e.imageUrl} variant={e.v} label={e.category} />
      <View style={styles.meta}>
        <View style={styles.row}>
          <Txt style={styles.when}>{whenText(e.dt)}</Txt>
          {e.tag ? <Tag label={e.tag} /> : null}
        </View>
        <Txt variant="heading" numberOfLines={2}>{e.title}</Txt>
        <Txt variant="small" numberOfLines={1}>{e.venue}, {e.city}</Txt>
        <View style={styles.bottom}>
          <Txt style={styles.price}>{priceText(e)}</Txt>
          <View style={styles.org}>
            <View style={styles.avatar}><Txt style={styles.initials}>{e.organizerInitials}</Txt></View>
            <Txt variant="small" numberOfLines={1} style={styles.orgName}>{e.organizerName}</Txt>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

/** Compact horizontal row (search results, "more dates"). */
export const EventRow = memo(function EventRow({ e }: { e: ListedEvent }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => openEvent(e)} disabled={!e.slug} style={({ pressed }) => [styles.rowCard, pressed ? { opacity: 0.9 } : null]}>
      <Poster imageUrl={e.imageUrl} variant={e.v} ratio={1} style={styles.rowPoster} rounded={14} />
      <View style={styles.rowMeta}>
        <Txt style={styles.when}>{whenText(e.dt)}</Txt>
        <Txt variant="heading" numberOfLines={2} style={{ fontSize: 17, lineHeight: 20 }}>{e.title}</Txt>
        <Txt variant="small" numberOfLines={1}>{e.venue}, {e.city}</Txt>
        <Txt style={styles.price}>{priceText(e)}</Txt>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { gap: 12 },
  meta: { gap: 5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  when: { fontFamily: fonts.sansSemi, fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.redSecond },
  bottom: { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  price: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 18, color: colors.red },
  org: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  avatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: red(0.3), backgroundColor: colors.sand, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.sansBold, fontSize: 9, lineHeight: 11, color: colors.red },
  orgName: { flexShrink: 1 },
  rowCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  rowPoster: { width: 112 },
  rowMeta: { flex: 1, gap: 4, paddingTop: 2 },
});
