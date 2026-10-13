"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { updateDispute, type ActionState } from "@/lib/admin/finance-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function DisputeDialog({ dispute }: { dispute: { id: number; code: string; status: string; notes: string | null; evidenceDue: string; closed: boolean; stripeId: string } }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await updateDispute(prev, fd);
    if (r?.ok) { toast.success("Dispute updated"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Manage</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Dispute on {dispute.code}</DialogTitle><DialogDescription>Stripe id <code className="font-mono text-xs wrap-anywhere">{dispute.stripeId}</code>. Submit evidence in the Stripe Dashboard; keep your notes and the outcome here.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="dispute_id" value={dispute.id} />
          <SelectField label="Status" id="d-status" name="status" defaultValue={dispute.status} options={[
            { value: "needs_response", label: "Needs response" }, { value: "under_review", label: "Under review" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "warning_closed", label: "Inquiry closed" }, { value: dispute.status, label: `Keep “${dispute.status.replace(/_/g, " ")}”` },
          ]} />
          <TextField label="Evidence due" id="d-due" name="evidence_due_at" type="datetime-local" defaultValue={dispute.evidenceDue} />
          <TextAreaField label="Notes (what was submitted, outcome)" id="d-notes" name="notes" rows={4} defaultValue={dispute.notes ?? ""} />
          <SelectField label="Case" id="d-close" name="close" defaultValue={dispute.closed ? "1" : "0"} options={[{ value: "0", label: "Open" }, { value: "1", label: "Closed" }]} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
