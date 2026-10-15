import { useRef, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/components/AuthShell';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

/** The app's first screen. Only organisation members (organization admin, organizer, staff / scanner) get in. */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<TextInput>(null);

  async function submit() {
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true); setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (e) {
      setError((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Organization admins, organizers and door staff." footer={<Txt variant="caption" center>Looking for your tickets? They are on the Fat Tixx website.</Txt>}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} maxLength={254} />
      <Field ref={pwRef} label="Password" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} maxLength={128} />
      <Pressable accessibilityRole="link" onPress={() => router.push('/forgot')} style={{ alignSelf: 'flex-end' }}><Txt variant="caption" color={colors.red}>Forgot password?</Txt></Pressable>
      <Button title={busy ? 'Signing in…' : 'Sign in'} size="lg" full onPress={submit} loading={busy} />
    </AuthShell>
  );
}
