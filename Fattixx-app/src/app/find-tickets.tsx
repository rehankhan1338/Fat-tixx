import { useState } from 'react';
import { api } from '@/api/client';
import { AuthShell } from '@/components/AuthShell';
import { Button, Field, Notice, Txt } from '@/components/ui';

/** Guest ticket lookup: emails a one-time link listing the orders for that address. */
export default function FindTicketsScreen() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try { const r = await api<{ message: string }>('/tickets/find', { method: 'POST', body: { email: email.trim() }, anonymous: true }); setMsg(r.message); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <AuthShell title="Find my tickets" subtitle="Enter the email you bought with. We’ll send a link to all your tickets.">
      {msg ? <Notice tone="success">{msg}</Notice> : (
        <>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus returnKeyType="send" onSubmitEditing={submit} maxLength={254} />
          <Button title="Email me a link" size="lg" full onPress={submit} loading={busy} disabled={!email.trim()} />
          <Txt variant="caption" center>The link opens on the website and stays valid for 30 minutes.</Txt>
        </>
      )}
    </AuthShell>
  );
}
