"use client";

import { useActionState, useState } from "react";
import { PencilIcon } from "lucide-react";
import { requestRefund, transferTicketFromOrder, updateAttendeeName } from "@/lib/orders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { TransferTicketDialog } from "@/components/transfer-ticket-dialog";

export function AttendeeNameForm({ code, token, ticketId, currentName, locked }: { code: string; token: string | null; ticketId: number; currentName: string | null; locked: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(async (prev: undefined | { error?: string; ok?: boolean }, fd: FormData) => { const r = await updateAttendeeName(prev, fd); if (r?.ok) setEditing(false); return r; }, undefined);
  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{currentName ?? <span className="text-muted-foreground">No attendee name</span>}</span>
        {!locked ? <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(true)}><PencilIcon /> Edit</Button> : null}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <FormStatus state={state} />
      <input type="hidden" name="code" value={code} />{token ? <input type="hidden" name="token" value={token} /> : null}<input type="hidden" name="ticket_id" value={ticketId} />
      <Input name="attendee_name" defaultValue={currentName ?? ""} placeholder="Attendee name" required minLength={2} autoFocus />
      <div className="flex gap-2"><SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
    </form>
  );
}

export function RefundRequestButton({ code, token, amountLabel }: { code: string; token: string | null; amountLabel: string }) {
  return (
    <ConfirmButton
      action={async (fd) => { fd.set("code", code); if (token) fd.set("token", token); return requestRefund(undefined, fd); }}
      title="Request a full refund?" description={`${amountLabel} will be returned to your original payment method and your tickets will be cancelled. This cannot be undone.`}
      confirmText="Refund my order" variant="outline" size="sm" successText="Refund issued. Check your email for confirmation."
    >
      Request a refund
    </ConfirmButton>
  );
}

export function BuyerTransferButton({ code, token, ticketId, ticketCode }: { code: string; token: string | null; ticketId: number; ticketCode: string }) {
  return (
    <TransferTicketDialog
      action={transferTicketFromOrder}
      fields={{ code, ticket_id: ticketId, ...(token ? { token } : {}) }}
      ticketCode={ticketCode}
      triggerProps={{ variant: "ghost", size: "sm", className: "w-full" }}
    />
  );
}
