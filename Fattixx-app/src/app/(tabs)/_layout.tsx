import { Tabs } from 'expo-router';
import { CalendarCheck, UserRound } from 'lucide-react-native';
import { colors, fonts, red } from '@/theme/tokens';

/**
 * The signed-in person's panel: the events they may work the door for, and their account. Every role
 * (organization admin, organizer, staff) gets the same two tabs; what differs is which events the server
 * lists and which check-in actions it allows.
 */
export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="events"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: red(0.5),
        tabBarStyle: { backgroundColor: colors.pureWhite, borderTopColor: red(0.12), height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11, marginBottom: 6 },
        sceneStyle: { backgroundColor: colors.ivory },
      }}
    >
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
