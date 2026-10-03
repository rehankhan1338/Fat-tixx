"use client";

import { useActionState, useState } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { notifyWaitlist, removeWaitlistEntry, requeueWaitlistEntry, type ActionState } from "@/lib/waitlist/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState, Section, StatusBadge, formatDate } from "@/components/shared";

export interface WaitlistView { id: number; email: string; name: string | null; quantity: number; status: string; ticket_type_name: string | null; created_at: string; notified_at: string | null }

function NotifyDialog({ orgSlug, eventId, waiting, ticketTypes, availableNote }: { orgSlug: string; eventId: number; waiting: number; ticketTypes: { id: number; name: string }[]; availableNote: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await notifyWaitlist(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Sent"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" disabled={!waiting} />}><SendIcon /> Release tickets to waitlist</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Notify the waitlist</DialogTitle><DialogDescription>Emails the oldest entries first with a link to buy. Make sure tickets are actually available: {availableNote}.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="How many people" id="wl-count" name="count" type="number" min={1} max={500} defaultValue={Math.min(waiting, 10)} hint={`${waiting} waiting`} />
            <SelectField label="Waiting for" id="wl-type" name="ticket_type_id" options={[{ value: "", label: "Any ticket type" }, ...ticketTypes.map((t) => ({ value: String(t.id), label: t.name }))]} hint="Includes people who asked for any ticket." />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Sending…">Send emails</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WaitlistPanel({ orgSlug, eventId, entries, canEdit, enabled, ticketTypes, availableNote }: { orgSlug: string; eventId: number; entries: WaitlistView[]; canEdit: boolean; enabled: boolean; ticketTypes: { id: number; name: string }[]; availableNote: string }) {
  const waiting = entries.filter((e) => e.status === "waiting").length;
  return (
    <Section title={`Waitlist (${waiting} waiting)`} description={enabled ? "People who asked to be told when sold-out tickets free up. Refunds and extra capacity do not notify automatically — release tickets here." : "The waitlist is turned off for this event (Details tab)."} actions={canEdit && enabled ? <NotifyDialog orgSlug={orgSlug} eventId={eventId} waiting={waiting} ticketTypes={ticketTypes} availableNote={availableNote} /> : null}>
      {entries.length === 0 ? <EmptyState title="Nobody waiting" description="The join form appears on the event page once a ticket type sells out." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Wants</TableHead><TableHead>Status</TableHead><TableHead>Joined</TableHead>{canEdit ? <TableHead /> : null}</TableRow></TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell><span className="font-medium">{e.name ?? "—"}</span><span className="block text-xs text-muted-foreground">{e.email}</span></TableCell>
                <TableCell>{e.quantity} × {e.ticket_type_name ?? "any ticket"}</TableCell>
                <TableCell><StatusBadge status={e.status === "waiting" ? "pending" : e.status === "notified" ? "sent" : e.status === "converted" ? "paid" : e.status} />{e.notified_at ? <span className="block text-[11px] text-muted-foreground">emailed {formatDate(e.notified_at)}</span> : null}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(e.created_at)}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right"><div className="flex justify-end gap-1">
                    {e.status === "notified" ? <ConfirmButton action={requeueWaitlistEntry} fields={{ org: orgSlug, event_id: eventId, entry_id: e.id }} title="Put back in the queue?" description="They will be emailed again on the next release." confirmText="Requeue" variant="ghost" successText="Back in the queue">Requeue</ConfirmButton> : null}
                    {e.status !== "converted" ? <ConfirmButton action={removeWaitlistEntry} fields={{ org: orgSlug, event_id: eventId, entry_id: e.id }} title={`Remove ${e.email}?`} confirmText="Remove" variant="ghost" successText="Removed">Remove</ConfirmButton> : null}
                  </div></TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
