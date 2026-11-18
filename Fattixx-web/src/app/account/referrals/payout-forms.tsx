"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { saveManualPayoutDetails, startReferrerOnboarding, type RefState } from "@/lib/social/referral-actions";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

export function StripePayoutButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending} onClick={() => start(async () => {
      const r = await startReferrerOnboarding();
      if (r?.url) window.location.href = r.url; else toast.error(r?.error ?? "Couldn’t start the setup.");
    })}>{pending ? "Opening Stripe…" : label}</Button>
  );
}

export function ManualPayoutForm({ saved }: { saved: boolean }) {
  const [state, action] = useActionState<RefState, FormData>(saveManualPayoutDetails, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      {saved ? <p className="text-sm text-muted-foreground">Your payout details are saved. Fattixx Finance pays you after each event; save again to change them.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Pay me with" id="po-method" name="method" options={[{ value: "paypal", label: "PayPal" }, { value: "venmo", label: "Venmo" }, { value: "zelle", label: "Zelle" }, { value: "cashapp", label: "Cash App" }]} />
        <TextField label="Account" id="po-handle" name="handle" required placeholder="Email, phone or @handle" maxLength={200} />
      </div>
      <SubmitButton pendingText="Saving…">Save payout details</SubmitButton>
    </form>
  );
}
