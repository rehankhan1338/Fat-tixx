"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, EyeIcon, EyeOffIcon, Loader2Icon, PlugZapIcon } from "lucide-react";
import { revealStripeKey, runReconciliation, saveStripeKeys, switchStripeMode, testStripeConnection, type ActionState } from "@/lib/admin/finance-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { FieldWrap, FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";

type Masked = { secret: string | null; publishable: string | null; webhook: string | null };

export function StripeSettingsPanel({ canEdit, mode, webhookUrl, test, live }: { canEdit: boolean; mode: "test" | "live"; webhookUrl: string; test: Masked; live: Masked }) {
  const [pending, start] = useTransition();
  const run = (fn: (fd: FormData) => Promise<ActionState>, fields: Record<string, string>) => start(async () => {
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const r = await fn(fd); if (r?.error) toast.error(r.error); else toast.success(r?.message ?? "Done");
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">Active mode <Badge variant="outline" className={mode === "live" ? "border-red-500/40 text-red-700" : "border-emerald-500/40 text-emerald-700"}>{mode === "live" ? "LIVE — real cards are charged" : "TEST — sandbox, no real money"}</Badge></CardTitle>
          <CardDescription>Checkout, refunds, disputes and reconciliation all use the keys of the active mode. Switch to live only after you have tested with the sandbox keys.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant={mode === "test" ? "default" : "outline"} disabled={!canEdit || pending || mode === "test"} onClick={() => run(switchStripeMode, { mode: "test" })}>Use test (sandbox) keys</Button>
          <Button variant={mode === "live" ? "destructive" : "outline"} disabled={!canEdit || pending || mode === "live"} onClick={() => { if (confirm("Switch to LIVE mode? Real cards will be charged from now on.")) run(switchStripeMode, { mode: "live" }); }}>Use live keys</Button>
          {!canEdit ? <p className="w-full text-xs text-muted-foreground">Only a Super Admin can change keys or switch modes.</p> : null}
        </CardContent>
      </Card>

      <Alert>
        <PlugZapIcon />
        <AlertTitle>Webhook endpoint</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>In the Stripe Dashboard add a webhook pointing at this URL and paste its signing secret below. Events: <code className="text-xs">payment_intent.succeeded</code>, <code className="text-xs">charge.refunded</code>, <code className="text-xs">charge.dispute.*</code>. For local testing run <code className="text-xs wrap-anywhere">stripe listen --forward-to localhost:3000/api/stripe/webhook</code> and use the <code className="text-xs">whsec_</code> it prints.</p>
          <div className="flex items-center gap-2"><code className="block flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{webhookUrl}</code><CopyButton value={webhookUrl} /></div>
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        <KeySetForm mode="test" current={test} canEdit={canEdit} onTest={() => run(testStripeConnection, { mode: "test" })} pending={pending} />
        <KeySetForm mode="live" current={live} canEdit={canEdit} onTest={() => run(testStripeConnection, { mode: "live" })} pending={pending} />
      </div>
    </div>
  );
}

function KeySetForm({ mode, current, canEdit, onTest, pending }: { mode: "test" | "live"; current: Masked; canEdit: boolean; onTest: () => void; pending: boolean }) {
  const [state, action] = useActionState(saveStripeKeys, undefined);
  const prefix = mode === "live" ? "live" : "test";
  const complete = !!(current.secret && current.publishable);
  return (
    <Card className={mode === "live" ? "border-red-500/30" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">{mode === "live" ? "Live keys" : "Test (sandbox) keys"} {complete ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700"><CheckCircle2Icon className="size-3" /> saved</Badge> : <Badge variant="outline">not set</Badge>}</CardTitle>
        <CardDescription>From Stripe Dashboard → Developers → API keys{mode === "test" ? " (toggle “Test mode” on)" : ""}. Blank fields keep the saved value; type <code>clear</code> to remove one.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <FormStatus state={state} successText={state?.message} />
          <input type="hidden" name="mode" value={mode} />
          <SecretKeyField label={`Secret key (sk_${prefix}_…)`} id={`${mode}-secret`} name="secret_key" mode={mode} field="secret" masked={current.secret} placeholder={`sk_${prefix}_…`} canEdit={canEdit} />
          <TextField label={`Publishable key (pk_${prefix}_…)`} id={`${mode}-pk`} name="publishable_key" autoComplete="off" placeholder={current.publishable ?? `pk_${prefix}_…`} disabled={!canEdit} hint={current.publishable ? <SavedValue value={current.publishable} /> : undefined} />
          <SecretKeyField label="Webhook signing secret (whsec_…)" id={`${mode}-whsec`} name="webhook_secret" mode={mode} field="webhook" masked={current.webhook} placeholder="whsec_…" canEdit={canEdit} emptyHint="Optional until you connect the webhook." />
          <div className="flex flex-wrap gap-2">
            <SubmitButton disabled={!canEdit} pendingText="Verifying with Stripe…">Save {mode} keys</SubmitButton>
            <Button type="button" variant="outline" disabled={!canEdit || !current.secret || pending} onClick={onTest}>{pending ? <Loader2Icon className="animate-spin" /> : null} Test connection</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** "Saved: …" hint; the value wraps so long keys never widen the card. Copy appears only for an unmasked value. */
function SavedValue({ value }: { value: string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 font-mono wrap-anywhere">Saved: {value}</span>
      {value.includes("•") ? null : <CopyButton value={value} />}
    </span>
  );
}

/**
 * Password-style input for a Stripe secret. The eye button reveals the *saved* key in full (fetched on demand
 * from the server, audited) and also shows whatever is being typed; clicking again hides both.
 */
function SecretKeyField({ label, id, name, mode, field, masked, placeholder, canEdit, emptyHint }: {
  label: string; id: string; name: string; mode: "test" | "live"; field: "secret" | "webhook"; masked: string | null; placeholder: string; canEdit: boolean; emptyHint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    if (visible) { setVisible(false); return; }
    if (masked && !full && canEdit) {
      setLoading(true);
      try {
        const fd = new FormData(); fd.set("mode", mode); fd.set("field", field);
        const r = await revealStripeKey(fd);
        if (r.error || !r.value) { toast.error(r.error ?? "Could not reveal the key."); return; }
        setFull(r.value);
      } finally { setLoading(false); }
    }
    setVisible(true);
  };
  const shown = visible && full ? full : masked;
  const title = visible ? "Hide key" : "Show full key";
  const hint = masked ? <SavedValue value={shown ?? ""} /> : emptyHint;
  return (
    <FieldWrap label={label} htmlFor={id} hint={hint}>
      <InputGroup>
        <InputGroupInput id={id} name={name} type={visible ? "text" : "password"} autoComplete="off" placeholder={shown ?? placeholder} disabled={!canEdit} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label={title} aria-pressed={visible} title={title} disabled={!canEdit || loading} onClick={toggle}>
            {loading ? <Loader2Icon className="animate-spin" /> : visible ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </FieldWrap>
  );
}

export function ReconcileForm({ configured }: { configured: boolean }) {
  const [state, action] = useActionState(runReconciliation, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="w-full"><FormStatus state={state} successText={state?.message} /></div>
      <SelectField label="Period" id="days" name="days" defaultValue="1" options={[{ value: "1", label: "Last 24 hours" }, { value: "3", label: "Last 3 days" }, { value: "7", label: "Last 7 days" }, { value: "31", label: "Last 31 days" }]} />
      <SubmitButton disabled={!configured} pendingText="Comparing with Stripe…">Run reconciliation</SubmitButton>
      {!configured ? <p className="text-xs text-muted-foreground">Add Stripe keys first.</p> : null}
    </form>
  );
}
