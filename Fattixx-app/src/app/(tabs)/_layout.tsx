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
  // The bar grows by the home-indicator area on notchless-bottom iPhones so the labels sit above it.
  const { bottom } = useSafeAreaInsets();
  return (
    <Tabs
      initialRouteName="events"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: red(0.5),
        tabBarStyle: { backgroundColor: colors.pureWhite, borderTopColor: red(0.12), height: 58 + bottom, paddingTop: 6, paddingBottom: bottom || 6 },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 14 },
        sceneStyle: { backgroundColor: colors.ivory },
      }}
    >
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
