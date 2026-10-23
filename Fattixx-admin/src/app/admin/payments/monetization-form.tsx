"use client";

import { useActionState } from "react";
import { saveMonetizationSettings } from "@/lib/admin/monetization-actions";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export type MonetizationValues = { payout_mode: string; connect_payout_delay_days: string; ad_cpm_cents: string; ad_min_impressions: string; sponsorship_fee_bps: string };

/** Payouts (manual / Stripe Connect), advertiser portal pricing and the sponsorship marketplace fee. */
export function MonetizationForm({ values, canEdit }: { values: MonetizationValues; canEdit: boolean }) {
  const [state, action] = useActionState(saveMonetizationSettings, undefined);
  return (
    <form action={action} className="space-y-5">
      <FormStatus state={state} successText={state?.message} />
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <SelectField label="How organizers are paid" id="m-mode" name="payout_mode" defaultValue={values.payout_mode} className="sm:col-span-2"
          options={[
            { value: "manual", label: "Manually by Fattixx (Admin → Payouts)" },
            { value: "connect", label: "Automatically with Stripe Connect (organizers set up under Dashboard → Payouts)" },
          ]}
          hint="With Stripe Connect, an organization stays on manual payouts until Stripe has verified it. Fattixx stays seller of record; fees and tax stay with Fattixx." />
        <TextField label="Payout delay (days)" id="m-delay" name="connect_payout_delay_days" type="number" min={2} max={30} defaultValue={values.connect_payout_delay_days} hint="How long Stripe holds an organizer's balance before paying it out. Applies to accounts set up after the change." />
        <TextField label="Sponsorship fee (%)" id="m-sp" name="sponsorship_fee_pct" type="number" min={0} max={50} step="0.1" defaultValue={String(Number(values.sponsorship_fee_bps) / 100)} hint="Fattixx's share of each sponsorship deal paid on the marketplace" />
        <TextField label="Advertiser price per 1,000 impressions ($)" id="m-cpm" name="ad_cpm_dollars" type="number" min={0.5} step="0.01" defaultValue={(Number(values.ad_cpm_cents) / 100).toFixed(2)} hint="Self-service advertiser portal (/advertise)" />
        <TextField label="Smallest impression purchase" id="m-min" name="ad_min_impressions" type="number" min={1000} step={1000} defaultValue={values.ad_min_impressions} />
      </fieldset>
      {canEdit ? <div className="flex justify-end"><SubmitButton pendingText="Saving…">Save</SubmitButton></div> : <p className="text-xs text-muted-foreground">Only a Super Admin can change these.</p>}
    </form>
  );
}
