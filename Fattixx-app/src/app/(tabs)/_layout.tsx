import { Tabs } from 'expo-router';
import { Compass, LayoutDashboard, ScanLine, Ticket, UserRound } from 'lucide-react-native';
import { useAuth } from '@/auth/AuthProvider';
import { colors, fonts, red } from '@/theme/tokens';

export default function TabsLayout() {
  const { account } = useAuth();
  const canScan = !!account?.canScan;
  // Organisers, their team and platform staff get the Manage tab; attendees never see it.
  const canManage = !!account && (account.memberships.length > 0 || account.user.roles.length > 0);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: red(0.5),
        tabBarStyle: { backgroundColor: colors.pureWhite, borderTopColor: red(0.12), height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11, marginBottom: 6 },
        sceneStyle: { backgroundColor: colors.ivory },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Discover', tabBarIcon: ({ color, size }) => <Compass color={color} size={size} /> }} />
      <Tabs.Screen name="tickets" options={{ title: 'Tickets', tabBarIcon: ({ color, size }) => <Ticket color={color} size={size} /> }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan', href: canScan ? undefined : null, tabBarIcon: ({ color, size }) => <ScanLine color={color} size={size} /> }} />
      <Tabs.Screen name="manage" options={{ title: 'Manage', href: canManage ? undefined : null, tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}
