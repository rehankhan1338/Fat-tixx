"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { approveSettlement, markPayoutPaid, voidPayout, type ActionState } from "@/lib/admin/finance-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";

export function ApproveSettlementDialog({ eventId, eventTitle, dueCents, currency }: { eventId: number; eventTitle: string; dueCents: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await approveSettlement(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Approved"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Approve settlement</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Approve settlement</DialogTitle><DialogDescription>{eventTitle}: {(dueCents / 100).toFixed(2)} {currency} is due to the organizer. Approving freezes the amount; record the payout after the transfer is sent.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="event_id" value={eventId} />
          <TextField label={`Amount (${currency})`} id="amount" name="amount" inputMode="decimal" required defaultValue={(dueCents / 100).toFixed(2)} hint="Reduce it to hold back a reserve for late refunds or disputes." />
          <TextAreaField label="Notes (optional)" id="notes" name="notes" rows={2} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Approving…">Approve</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MarkPaidDialog({ payoutId, amountLabel }: { payoutId: number; amountLabel: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await markPayoutPaid(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Recorded"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Record payout</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payout of {amountLabel}</DialogTitle><DialogDescription>Enter how the money was sent so the settlement history is complete.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="payout_id" value={payoutId} />
          <SelectField label="Method" id="method" name="method" defaultValue="bank_transfer" options={[{ value: "bank_transfer", label: "Bank transfer / ACH" }, { value: "check", label: "Check" }, { value: "stripe", label: "Stripe transfer" }, { value: "cash", label: "Cash" }, { value: "other", label: "Other" }]} />
          <TextField label="Reference" id="reference" name="reference" placeholder="Transfer id, check number…" />
          <TextAreaField label="Notes (optional)" id="paid-notes" name="notes" rows={2} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Saving…">Mark as paid</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidPayoutButton({ payoutId }: { payoutId: number }) {
  return <ConfirmButton action={voidPayout} fields={{ payout_id: payoutId }} title="Void this approval?" description="The amount returns to the event's balance due. Use this if the settlement was approved by mistake." confirmText="Void" variant="ghost" successText="Approval voided">Void</ConfirmButton>;
}
