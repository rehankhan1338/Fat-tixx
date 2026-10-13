"use client";

import { useActionState } from "react";
import { updatePlatformSettings } from "@/lib/admin/actions";
import type { Settings } from "@/lib/settings";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Separator } from "@/components/ui/separator";

export function SettingsForm({ settings: s }: { settings: Settings }) {
  const [state, action] = useActionState(updatePlatformSettings, undefined);
  return (
    <form action={action} className="space-y-6">
      <FormStatus state={state} successText="Settings saved." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Platform fee (% of ticket price)" id="platform_fee_pct" name="platform_fee_pct" type="number" step="0.01" min={0} max={50} defaultValue={(Number(s.platform_fee_bps) / 100).toFixed(2)} />
        <TextField label="Platform fee, fixed per ticket ($)" id="platform_fee_fixed" name="platform_fee_fixed" type="number" step="0.01" min={0} defaultValue={(Number(s.platform_fee_fixed_cents) / 100).toFixed(2)} />
        <TextField label="Card processing estimate (%)" id="processing_fee_pct" name="processing_fee_pct" type="number" step="0.01" min={0} defaultValue={(Number(s.processing_fee_bps) / 100).toFixed(2)} hint="Stripe standard is 2.9% + $0.30 per transaction." />
        <TextField label="Card processing, fixed per order ($)" id="processing_fee_fixed" name="processing_fee_fixed" type="number" step="0.01" min={0} defaultValue={(Number(s.processing_fee_fixed_cents) / 100).toFixed(2)} />
        <SelectField label="Default fee mode for new events" id="default_fee_mode" name="default_fee_mode" defaultValue={s.default_fee_mode} options={[{ value: "buyer_pays", label: "Buyer pays fees (added to the all-in price)" }, { value: "organizer_absorbs", label: "Organizer absorbs fees (deducted at settlement)" }]} />
        <TextField label="Checkout hold time (minutes)" id="hold_minutes" name="hold_minutes" type="number" min={3} max={60} defaultValue={s.hold_minutes} hint="Tickets are reserved for the buyer this long during checkout." />
      </div>
      <Separator />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Platform name" id="platform_name" name="platform_name" defaultValue={s.platform_name} />
        <TextField label="Support email" id="support_email" name="support_email" type="email" defaultValue={s.support_email} hint="Shown on tickets and receipts." />
      </div>
      <p className="text-xs text-muted-foreground">Admissions and sales tax are configured per venue and per event, because rates depend on location.</p>
      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </form>
  );
}
