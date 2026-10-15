import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/AuthProvider';

/** "/" has no page of its own: the app opens on the sign-in screen, and a signed-in person goes to their events. */
export default function IndexRoute() {
  const { status } = useAuth();
  return <Redirect href={status === 'signed-in' ? '/events' : '/login'} />;
}
