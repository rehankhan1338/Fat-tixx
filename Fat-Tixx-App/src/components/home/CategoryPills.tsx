import { ScrollView, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Pill } from '@/components/ui';
import { colors, GUTTER, red } from '@/theme/tokens';

/** Same list and icon paths as the website (src/lib/event-categories.ts). */
export const CATEGORIES = [
  { name: 'Music', icon: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  { name: 'Nightlife', icon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' },
  { name: 'Beauty & hair', icon: 'M6 3v18M10 3v18M6 8h4M14 3l4 4-4 4M18 7H10' },
  { name: 'Education', icon: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5' },
  { name: 'Community', icon: 'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6' },
  { name: 'Fundraisers', icon: 'M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z' },
  { name: 'Food & drink', icon: 'M4 3v8a3 3 0 0 0 6 0V3M7 3v18M17 3c-2 2-3 5-3 8h4V3zM18 11v10' },
  { name: 'Comedy', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14c1 2 2.5 3 4 3s3-1 4-3M9 9h.01M15 9h.01' },
  { name: 'Fitness', icon: 'M13 4a2 2 0 1 0 0-.01M9 20l3-6 3 3v4M7 12l3-4 4 2 3 3' },
];

export function CategoryPills({ value, onChange }: { value: string; onChange: (cat: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {CATEGORIES.map((c) => {
        const active = value === c.name;
        return (
          <Pill key={c.name} label={c.name} active={active} shadow onPress={() => onChange(active ? '' : c.name)}
            style={styles.pill}
            icon={<Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={active ? colors.ivory : red(0.78)} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d={c.icon} /></Svg>} />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ row: { paddingHorizontal: GUTTER, gap: 10, paddingVertical: 6 }, pill: { minHeight: 46 } });
