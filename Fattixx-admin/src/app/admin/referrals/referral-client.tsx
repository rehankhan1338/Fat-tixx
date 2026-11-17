"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { clearRewardFlag, markReferrerPaid, reverseFlaggedReward, saveReferralShare, type RefState } from "@/lib/social/referral-actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

export function ShareForm({ percent }: { percent: number }) {
  const [state, action] = useActionState<RefState, FormData>(saveReferralShare, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} successText={state?.message} />
      <TextField label="Fattixx share (%)" id="rs-pct" name="share_percent" type="number" min={0} max={100} step="0.01" defaultValue={percent} className="w-40" />
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}

export function FlagActions({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await clearRewardFlag(id); router.refresh(); })}>Clear</Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => { if (confirm("Reverse this reward? The referrer won’t be paid for this order.")) start(async () => { await reverseFlaggedReward(id); router.refresh(); }); }}>Reverse</Button>
    </div>
  );
}

export function MarkPaidButton({ userId, amount }: { userId: number; amount: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button size="sm" disabled={pending} onClick={() => {
      const ref = prompt(`Paid ${amount}? Enter the payment reference (e.g. PayPal transaction id):`);
      if (!ref) return;
      start(async () => { const r = await markReferrerPaid(userId, ref); if (r?.error) toast.error(r.error); else toast.success(r?.message ?? "Marked paid"); router.refresh(); });
    }}>Mark paid</Button>
  );
}
