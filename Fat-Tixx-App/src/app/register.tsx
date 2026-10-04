import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/components/AuthShell';
import { Button, Field, Notice, Txt } from '@/components/ui';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  // When the form opened: the server rejects submissions faster than a person could type (bot check).
  const [startedAt] = useState(() => Date.now());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const pwRef = useRef<TextInput>(null);

  async function submit() {
    setError(null); setField(null);
    if (name.trim().length < 2) { setField('name'); return setError('Enter your name.'); }
    if (password.length < 12) { setField('password'); return setError('Use at least 12 characters.'); }
    setBusy(true);
    try {
      const r = await signUp(name.trim(), email.trim(), password, startedAt);
      if (r.pending) setDone(r.message ?? 'Check your email to finish setting up your account.');
      else { if (router.canGoBack()) router.back(); else router.replace('/'); }
    } catch (e) {
      const err = e as ApiError;
      setError(err.message); setField(err.field ?? null);
    } finally { setBusy(false); }
  }

  if (done) return <AuthShell title="Almost there"><Notice tone="success">{done}</Notice><Button title="Back to sign in" variant="outline" onPress={() => router.replace('/login')} /></AuthShell>;

  return (
    <AuthShell title="Create your account" subtitle="Keep all your tickets in one place." footer={<Txt variant="small">Already have an account? <Txt variant="bodyStrong" style={{ fontSize: 13 }} onPress={() => router.replace('/login')}>Sign in</Txt></Txt>}>
      {error && !field ? <Notice tone="error">{error}</Notice> : null}
      <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoFocus returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} maxLength={120} required error={field === 'name' ? error : null} />
      <Field ref={emailRef} label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} maxLength={254} required error={field === 'email' ? error : null} />
      <Field ref={pwRef} label="Password" value={password} onChangeText={setPassword} secure autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={submit} maxLength={128} required hint="At least 12 characters. Passwords found in known data breaches are rejected." error={field === 'password' ? error : null} />
      <Button title={busy ? 'Creating…' : 'Create account'} size="lg" full onPress={submit} loading={busy} />
      <Txt variant="caption" center>By creating an account you agree to the Terms of service and Privacy policy (see Account → Legal).</Txt>
    </AuthShell>
  );
}
