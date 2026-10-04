import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, GUTTER, red } from '@/theme/tokens';
import { Txt } from './Text';

/**
 * Page scaffold: ivory background, safe areas, optional compact header with a back button, keyboard
 * avoidance for forms and pull-to-refresh.
 */
export function Screen({ children, title, back, right, refreshing, onRefresh, scroll = true, padded = true, bg = colors.ivory, contentStyle, keyboard, ...rest }: {
  children: ReactNode; title?: string; back?: boolean; right?: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean; bg?: string;
  contentStyle?: ScrollViewProps['contentContainerStyle']; keyboard?: boolean;
} & Omit<ScrollViewProps, 'children'>) {
  const insets = useSafeAreaInsets();
  const header = title || back || right ? (
    <View style={styles.header}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={styles.back}>
          <ArrowLeft size={22} color={colors.red} />
        </Pressable>
      ) : <View style={styles.back} />}
      <Txt variant="heading" numberOfLines={1} style={styles.title}>{title ?? ''}</Txt>
      <View style={styles.right}>{right}</View>
    </View>
  ) : null;
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.red} colors={[colors.red]} /> : undefined}
      contentContainerStyle={[padded ? styles.padded : null, { paddingBottom: insets.bottom + 32 }, contentStyle]}
      {...rest}
    >
      {children}
    </ScrollView>
  ) : <View style={[styles.fill, padded ? styles.padded : null]}>{children}</View>;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: bg }]}>
      {header}
      {keyboard ? <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>{body}</KeyboardAvoidingView> : body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  padded: { paddingHorizontal: GUTTER, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: red(0.12) },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
  right: { minWidth: 44, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 6 },
});
