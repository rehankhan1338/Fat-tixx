import { useState } from 'react';
import { router } from 'expo-router';
import { api } from '@/api/client';
import { AuthShell } from '@/components/AuthShell';
import { Button, Field, Notice, Txt } from '@/components/ui';

export default function ForgotScreen() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try { const r = await api<{ message: string }>('/auth/forgot', { method: 'POST', body: { email: email.trim() }, anonymous: true }); setMsg(r.message); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Reset your password" subtitle="We’ll email you a link to choose a new one." footer={<Txt variant="bodyStrong" style={{ fontSize: 13 }} onPress={() => router.replace('/login')}>Back to sign in</Txt>}>
      {msg ? <Notice tone="success">{msg}</Notice> : (
        <>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus returnKeyType="send" onSubmitEditing={submit} maxLength={254} />
          <Button title="Send link" size="lg" full onPress={submit} loading={busy} disabled={!email.trim()} />
        </>
      )}
    </AuthShell>
  );
}
