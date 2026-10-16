"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, Loader2Icon, SendIcon } from "lucide-react";
import { saveEmailSettings, sendTestEmail } from "@/lib/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export type EmailFormProps = {
  canEdit: boolean;
  /** Brevo key currently in use, masked (e.g. "xkeysib-••••••••1a2b"), or null when none. */
  maskedKey: string | null;
  /** Where that key comes from: saved here, the BREVO_API_KEY environment variable, or nowhere. */
  source: "settings" | "env" | null;
  /** SMTP_URL fallback in use (no Brevo key). */
  smtp: boolean;
  from: string;
};

/**
 * Brevo API key + sender. The key is stored encrypted in the database (like the Stripe keys) so the public site and
 * this console share it; saving verifies the key with Brevo and warns when the sender is not verified there.
 */
export function EmailSettingsForm({ canEdit, maskedKey, source, smtp, from }: EmailFormProps) {
  const [state, action] = useActionState(saveEmailSettings, undefined);
  const [pending, start] = useTransition();
  const configured = !!maskedKey || smtp;
  const test = () => start(async () => {
    const r = await sendTestEmail();
    if (r?.error) toast.error(r.error); else toast.success(r?.message ?? "Sent");
  });

  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Status</span>
        {configured
          ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700"><CheckCircle2Icon className="size-3" /> {maskedKey ? `Brevo · key ${source === "env" ? "from the environment (BREVO_API_KEY)" : "saved here"}` : "SMTP (SMTP_URL)"}</Badge>
          : <Badge variant="outline" className="border-amber-500/40 text-amber-700">Not configured — emails are only recorded in the outbox</Badge>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Brevo API key (xkeysib-…)" id="brevo_api_key" name="brevo_api_key" type="password" autoComplete="off"
          placeholder={maskedKey ?? "xkeysib-…"} disabled={!canEdit}
          hint={maskedKey ? <>Saved: <span className="font-mono">{maskedKey}</span>. Leave blank to keep it; type <code>clear</code> to remove it.</> : <>From Brevo → Settings → SMTP &amp; API → API keys. The key is encrypted at rest.</>}
        />
        <TextField
          label="Sender (From)" id="mail_from" name="mail_from" autoComplete="off" defaultValue={from} disabled={!canEdit}
          hint="Name <address>. The address must be a verified sender in Brevo, or every send is rejected."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <SubmitButton disabled={!canEdit} pendingText="Verifying with Brevo…">Save email settings</SubmitButton>
        <Button type="button" variant="outline" disabled={!canEdit || !configured || pending} onClick={test}>{pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Send me a test email</Button>
      </div>
      {!canEdit ? <p className="text-xs text-muted-foreground">Only a Super Admin can change email delivery.</p> : null}
    </form>
  );
}
