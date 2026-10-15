import { router } from 'expo-router';
import { Button, EmptyState, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <Screen back title="Not found">
      <EmptyState title="That page doesn’t exist" description="The link may be old or mistyped." action={<Button title="Go home" onPress={() => router.replace('/')} />} />
    </Screen>
  );
}
