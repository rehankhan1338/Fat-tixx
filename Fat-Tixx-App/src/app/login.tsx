import { useRef, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/components/AuthShell';
import { Button, Field, Notice, Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

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
      if (router.canGoBack()) router.back(); else router.replace('/');
    } catch (e) {
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back." footer={<><Txt variant="small">New here? <Txt variant="bodyStrong" style={{ fontSize: 13 }} onPress={() => router.replace('/register')}>Create an account</Txt></Txt><Txt variant="caption">Buying tickets does not need an account.</Txt></>}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" autoFocus returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} maxLength={254} />
      <Field ref={pwRef} label="Password" value={password} onChangeText={setPassword} secure autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} maxLength={128} />
      <Pressable accessibilityRole="link" onPress={() => router.push('/forgot')} style={{ alignSelf: 'flex-end' }}><Txt variant="caption" color={colors.red}>Forgot password?</Txt></Pressable>
      <Button title={busy ? 'Signing in…' : 'Sign in'} size="lg" full onPress={submit} loading={busy} />
    </AuthShell>
  );
}
