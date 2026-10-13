"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2Icon, MailIcon, MoreHorizontalIcon, PencilIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { refundOrder, resendOrderTickets, staffTransferTicket, staffUpdateAttendee, type ActionState } from "@/lib/orders/actions";
import { cancelOrder, deleteOrder, voidTicket } from "@/lib/orders/manage-actions";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { StatusBadge } from "@/components/shared";
import { TransferTicketDialog } from "@/components/transfer-ticket-dialog";

export function OrderStaffActions({ orgSlug, code, status, remainingCents, currency, canRefund, hasStripe, isSuperAdmin = false }: { orgSlug: string; code: string; status: string; remainingCents: number; currency: string; canRefund: boolean; hasStripe: boolean; isSuperAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("full");
  const [dialog, setDialog] = useState<null | "cancel" | "delete">(null);
  const [pending, start] = useTransition();
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await refundOrder(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Refunded"); setOpen(false); }
    return r;
  }, undefined);
  const [cancelState, cancelAction] = useActionState(async (_prev: ActionState, fd: FormData) => {
    const r = await cancelOrder(fd);
    if (r?.ok) { toast.success(r.message ?? "Order cancelled"); setDialog(null); }
    return r;
  }, undefined);
  const live = ["paid", "partially_refunded"].includes(status);
  const refundable = live && remainingCents > 0;

  return (
    <>
      {live ? <ConfirmButton action={resendOrderTickets} fields={{ org: orgSlug, code }} title="Resend tickets?" description="The buyer receives the confirmation email with all ticket links again." confirmText="Send" variant="outline" size="default" successText="Tickets re-sent"><MailIcon /> Resend tickets</ConfirmButton> : null}
      {canRefund && refundable ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="destructive" />}>Refund</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Refund order {code}</DialogTitle><DialogDescription>{formatCents(remainingCents, currency)} can still be refunded. {hasStripe ? "The refund goes back to the original card through Stripe." : "This order has no card payment; the refund is recorded only."} A full refund voids the tickets.</DialogDescription></DialogHeader>
            <form action={action} className="space-y-4">
              <FormStatus state={state} />
              <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="code" value={code} />
              <SelectField label="Amount" id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: "full", label: `Full refund (${formatCents(remainingCents, currency)})` }, { value: "partial", label: "Partial refund" }]} />
              {mode === "partial" ? <TextField label="Amount ($)" id="amount" name="amount" inputMode="decimal" placeholder="10.00" required /> : null}
              <TextAreaField label="Reason (sent to the buyer, kept in the audit log)" id="reason" name="reason" rows={3} required />
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton variant="destructive" pendingText="Refunding…">Issue refund</SubmitButton></div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {(canRefund && live) || isSuperAdmin ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More order actions" />}><MoreHorizontalIcon /></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canRefund && live ? <DropdownMenuItem variant="destructive" onClick={() => setDialog("cancel")}>Cancel order (void tickets, no refund)</DropdownMenuItem> : null}
            {isSuperAdmin ? (<>
              {canRefund && live ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>Delete order permanently</DropdownMenuItem>
            </>) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel order {code}</DialogTitle><DialogDescription>Every ticket on this order becomes invalid and the seats return to inventory. No money is refunded; use Refund for that. The buyer is emailed the reason.</DialogDescription></DialogHeader>
          <form action={cancelAction} className="space-y-4">
            <FormStatus state={cancelState} />
            <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="code" value={code} />
            <TextAreaField label="Reason" id="cancel-reason" name="reason" rows={3} required placeholder="Duplicate order, requested by buyer…" />
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Back</Button><SubmitButton variant="destructive" pendingText="Cancelling…">Cancel order & void tickets</SubmitButton></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete order {code} permanently?</DialogTitle><DialogDescription>Super Admin only. The order, its tickets and check-in records are removed and disappear from reports. No refund is issued. This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Back</Button>
            <Button variant="destructive" disabled={pending} onClick={() => start(async () => { const fd = new FormData(); fd.set("code", code); const r = await deleteOrder(fd); if (r?.error) toast.error(r.error); })}>{pending ? <Loader2Icon className="animate-spin" /> : null} Delete permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TicketEditRow({ orgSlug, code, ticket, canVoid = false, canTransfer = false }: { orgSlug: string; code: string; ticket: { id: number; code: string; type: string; seat: string | null; name: string | null; email: string | null; status: string; checkedInAt: string | null; note?: string | null }; canVoid?: boolean; canTransfer?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await staffUpdateAttendee(prev, fd);
    if (r?.ok) { toast.success("Attendee updated"); setOpen(false); }
    return r;
  }, undefined);
  const live = ["valid", "used"].includes(ticket.status);
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{ticket.code}</TableCell>
      <TableCell>{ticket.type}{ticket.seat ? <span className="block text-xs text-muted-foreground">{ticket.seat}</span> : null}</TableCell>
      <TableCell>{ticket.name ?? <span className="text-muted-foreground">—</span>}{ticket.email ? <span className="block text-xs text-muted-foreground">{ticket.email}</span> : null}{ticket.note ? <span className="block text-[11px] text-muted-foreground">{ticket.note}</span> : null}</TableCell>
      <TableCell><StatusBadge status={ticket.status} /></TableCell>
      <TableCell className="text-xs text-muted-foreground">{ticket.checkedInAt ?? "—"}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit attendee" />}><PencilIcon /></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Edit attendee</DialogTitle><DialogDescription>Ticket {ticket.code}</DialogDescription></DialogHeader>
              <form action={action} className="space-y-4">
                <FormStatus state={state} />
                <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="code" value={code} /><input type="hidden" name="ticket_id" value={ticket.id} />
                <TextField label="Attendee name" id={`an-${ticket.id}`} name="attendee_name" defaultValue={ticket.name ?? ""} />
                <TextField label="Attendee email" id={`ae-${ticket.id}`} name="attendee_email" type="email" defaultValue={ticket.email ?? ""} />
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
              </form>
            </DialogContent>
          </Dialog>
          {canTransfer && ticket.status === "valid" ? (
            <TransferTicketDialog action={staffTransferTicket} fields={{ org: orgSlug, code, ticket_id: ticket.id }} ticketCode={ticket.code}
              description="A new ticket is issued to the recipient and emailed to them. The current QR code and link stop working immediately. Staff transfers ignore the event’s attendee transfer setting."
              trigger={<SendIcon />} triggerProps={{ variant: "ghost", size: "icon-sm", "aria-label": "Transfer ticket" }} />
          ) : null}
          {canVoid && live ? <ConfirmButton action={voidTicket} fields={{ org: orgSlug, code, ticket_id: ticket.id, reason: "Voided by staff" }} title={`Void ticket ${ticket.code}?`} description="The ticket stops scanning as valid and its seat returns to inventory. The order and any payment are unchanged." confirmText="Void ticket" variant="ghost" successText="Ticket voided">Void</ConfirmButton> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
