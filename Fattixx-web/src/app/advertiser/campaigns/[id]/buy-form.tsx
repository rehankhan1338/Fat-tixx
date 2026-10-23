"use client";

import { useActionState, useState } from "react";
import { buyImpressions } from "@/lib/ads/advertiser-actions";
import { impressionPriceCents } from "@/lib/ads/placements";
import { formatCents } from "@/lib/money";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

/** Choose how many impressions to buy; the price updates as you type. Continues to Stripe Checkout. */
export function BuyImpressionsForm({ campaignId, cpmCents, min, ready }: { campaignId: number; cpmCents: number; min: number; ready: boolean }) {
  const [state, action] = useActionState(buyImpressions, undefined);
  const [n, setN] = useState(String(Math.max(min, 10_000)));
  const count = Math.round(Number(n)) || 0;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} />
      <input type="hidden" name="campaign_id" value={campaignId} />
      <TextField label="Impressions" id="buy-n" name="impressions" type="number" min={min} step={1000} value={n} onChange={(e) => setN(e.target.value)} className="w-48"
        hint={`At least ${min.toLocaleString()}; ${formatCents(cpmCents)} per 1,000`} />
      <p className="pb-6 text-lg font-semibold tabular-nums" aria-live="polite">{count >= min ? formatCents(impressionPriceCents(count, cpmCents)) : "—"}</p>
      <SubmitButton pendingText="Opening checkout…" disabled={!ready || count < min} className="mb-6">Pay and submit for review</SubmitButton>
      {!ready ? <p className="w-full text-sm text-muted-foreground">Add at least one creative before paying.</p> : null}
    </form>
  );
}
