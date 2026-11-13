import { Tabs } from 'expo-router';
import { CalendarCheck, UserRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, red } from '@/theme/tokens';

/**
 * The signed-in person's panel: the events they may work the door for, and their account. Every role
 * (organization admin, organizer, staff) gets the same two tabs; what differs is which events the server
 * lists and which check-in actions it allows.
 */
export default function TabsLayout() {
  // On iPhones with a home indicator the labels only need to clear the indicator line (~20pt), not the
  // full 34pt inset, so the tabs sit with even space above and below.
  const { bottom } = useSafeAreaInsets();
  const padTop = 12;
  const padBottom = bottom > 0 ? Math.min(bottom, 20) : 12;
  return (
    <Tabs
      initialRouteName="events"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: red(0.5),
        tabBarStyle: { backgroundColor: colors.pureWhite, borderTopColor: red(0.12), height: 50 + padTop + padBottom, paddingTop: padTop, paddingBottom: padBottom },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 14 },
        sceneStyle: { backgroundColor: colors.ivory },
      }}
    >
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
