"use client";

import { useState, useTransition } from "react";
import { MoreHorizontalIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { setEventStatus, deleteEvent, duplicateEvent } from "@/lib/events/actions";
import { cancelEvent, postponeEvent } from "@/lib/orders/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function EventStatusActions({ orgSlug, eventId, status, hasTicketTypes, canDelete, paidOrders, isSuperAdmin = false, inSeries = false }: { orgSlug: string; eventId: number; status: string; hasTicketTypes: boolean; canDelete: boolean; paidOrders: number; isSuperAdmin?: boolean; inSeries?: boolean }) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "cancel" | "postpone" | "duplicate" | "series">(null);

  function run(fn: (fd: FormData) => Promise<{ error?: string; ok?: boolean; message?: string } | void>, fields: Record<string, string | number>, ok: string) {
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
      const r = await fn(fd);
      if (r && r.error) toast.error(r.error); else toast.success(r?.message ?? ok);
    });
  }

  return (
    <>
      {status === "draft" || status === "postponed" ? (
        hasTicketTypes ? (
          <Button disabled={pending} onClick={() => run(setEventStatus, { org: orgSlug, event_id: eventId, status: "published" }, "Event published")}>
            {pending ? <Loader2Icon className="animate-spin" /> : null} Publish
          </Button>
        ) : (
          // a disabled button gets no hover or focus events, so the wrapper carries the explanation
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} className="inline-flex cursor-not-allowed rounded-md" aria-label="Publish: add a ticket type first" />}>
              <Button disabled className="pointer-events-none">Publish</Button>
            </TooltipTrigger>
            <TooltipContent>Add at least one ticket type (Ticket types tab) before publishing.</TooltipContent>
          </Tooltip>
        )
      ) : null}
      {status === "published" ? <Button variant="outline" disabled={pending} onClick={() => run(setEventStatus, { org: orgSlug, event_id: eventId, status: "draft" }, "Event unpublished")}>Unpublish</Button> : null}

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}><MoreHorizontalIcon /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status !== "cancelled" ? <DropdownMenuItem onClick={() => setDialog("postpone")}>Postpone (keep tickets valid)</DropdownMenuItem> : null}
          {status !== "cancelled" ? <DropdownMenuItem variant="destructive" onClick={() => setDialog("cancel")}>Cancel event & refund everyone</DropdownMenuItem> : null}
          {status === "published" || status === "postponed" ? <DropdownMenuItem onClick={() => run(setEventStatus, { org: orgSlug, event_id: eventId, status: "completed" }, "Marked completed")}>Mark as completed</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialog("duplicate")}>Duplicate to another date</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("series")}>{inSeries ? "Add more recurring dates" : "Make recurring (weekly, monthly…)"}</DropdownMenuItem>
          {canDelete && (paidOrders === 0 || isSuperAdmin) ? (<><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => {
            const msg = paidOrders > 0
              ? `Super Admin: permanently delete this event together with its ${paidOrders} paid order(s), tickets and check-in records? No refunds are issued (use Cancel for that). This cannot be undone.`
              : "Delete this event permanently? This cannot be undone.";
            if (confirm(msg)) run(deleteEvent, { org: orgSlug, event_id: eventId }, "Event deleted");
          }}>Delete event{paidOrders > 0 ? " (force)" : ""}</DropdownMenuItem></>) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "postpone"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <form action={(fd) => { run(postponeEvent, Object.fromEntries(fd.entries()) as Record<string, string>, "Event postponed and attendees notified"); setDialog(null); }} className="space-y-4">
            <DialogHeader><DialogTitle>Postpone event</DialogTitle><DialogDescription>Existing tickets stay valid for the new date. Every ticket holder receives an email.</DialogDescription></DialogHeader>
            <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
            <TextField label="New start date & time (leave blank if not yet known)" id="new_starts_at" name="new_starts_at" type="datetime-local" />
            <TextAreaField label="Message to attendees" id="message" name="message" rows={4} required placeholder="We are moving the show to…" />
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Back</Button><Button type="submit">Postpone & notify</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "duplicate"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <form action={(fd) => { run((f) => duplicateEvent(undefined, f), Object.fromEntries(fd.entries()) as Record<string, string>, "Event duplicated"); setDialog(null); }} className="space-y-4">
            <DialogHeader><DialogTitle>Duplicate event</DialogTitle><DialogDescription>Copies the details, image, schedule, ticket types (inventory reset), add-ons and questions to a new date. Sales windows shift by the same amount.</DialogDescription></DialogHeader>
            <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} /><input type="hidden" name="mode" value="single" />
            <TextField label="New start date & time" id="new_starts_at" name="new_starts_at" type="datetime-local" required />
            {status === "published" ? <CheckField id="dup-publish" name="publish" label="Publish the copy immediately" hint="Otherwise it is created as a draft." /> : null}
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Back</Button><Button type="submit">Duplicate</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "series"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <form action={(fd) => { run((f) => duplicateEvent(undefined, f), Object.fromEntries(fd.entries()) as Record<string, string>, "Recurring dates created"); setDialog(null); }} className="space-y-4">
            <DialogHeader><DialogTitle>Recurring event</DialogTitle><DialogDescription>Creates copies of this event at a regular interval. Each occurrence has its own inventory and attendee list; the public page links between the dates.</DialogDescription></DialogHeader>
            <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} /><input type="hidden" name="mode" value="series" />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Repeats" id="frequency" name="frequency" defaultValue="weekly" options={[{ value: "daily", label: "Every day" }, { value: "weekly", label: "Every week" }, { value: "biweekly", label: "Every 2 weeks" }, { value: "monthly", label: "Every month" }]} />
              <TextField label="More occurrences" id="count" name="count" type="number" min={1} max={52} defaultValue={4} hint="After this one (max 52)." />
            </div>
            {status === "published" ? <CheckField id="series-publish" name="publish" label="Publish the new dates immediately" hint="Otherwise they are created as drafts." /> : null}
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Back</Button><Button type="submit">Create dates</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <form action={(fd) => { run(cancelEvent, Object.fromEntries(fd.entries()) as Record<string, string>, "Event cancelled; refunds are being processed"); setDialog(null); }} className="space-y-4">
            <DialogHeader><DialogTitle>Cancel event</DialogTitle><DialogDescription>{paidOrders ? `All ${paidOrders} paid orders will be refunded in full and every ticket holder notified. ` : ""}This cannot be undone.</DialogDescription></DialogHeader>
            <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
            <TextAreaField label="Reason shown to attendees" id="reason" name="reason" rows={4} required />
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setDialog(null)}>Back</Button><Button type="submit" variant="destructive">Cancel event & refund</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
