"use client";

import { useActionState, useState } from "react";
import { CalendarPlusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { createEventDate, updateEventDate, deleteEventDate, type ActionState } from "@/lib/events/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState, Section } from "@/components/shared";

export interface EventDateView { id: number; label: string | null; starts_at: string; ends_at: string; doors_at: string; when: string; ticketTypes: number }

function DateDialog({ orgSlug, eventId, date, trigger, firstExtra }: { orgSlug: string; eventId: number; date?: EventDateView; trigger?: React.ReactNode; firstExtra?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = date ? await updateEventDate(prev, fd) : await createEventDate(prev, fd);
    if (r?.ok) { toast.success(date ? "Day updated" : "Day added"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={!trigger} render={trigger ? <span /> : <Button />}>{trigger ?? <><CalendarPlusIcon /> Add a day</>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{date ? `Edit ${date.label ?? "day"}` : "Add a day"}</DialogTitle>
          <DialogDescription>{firstExtra ? "The event's current date becomes Day 1. Multi-day passes are valid on every day; you can also sell tickets for one day only." : "Times are in the event's time zone."}</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          {date ? <input type="hidden" name="date_id" value={date.id} /> : null}
          <TextField label="Label" id="d-label" name="label" maxLength={80} placeholder={date ? "" : "e.g. Day 2 or Saturday"} defaultValue={date?.label ?? ""} />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Starts" id="d-start" name="starts_at" type="datetime-local" required defaultValue={date?.starts_at} />
            <TextField label="Ends" id="d-end" name="ends_at" type="datetime-local" defaultValue={date?.ends_at} />
            <TextField label="Doors" id="d-doors" name="doors_at" type="datetime-local" defaultValue={date?.doors_at} />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Saving…">{date ? "Save" : "Add day"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulePanel({ orgSlug, eventId, dates, canEdit }: { orgSlug: string; eventId: number; dates: EventDateView[]; canEdit: boolean }) {
  return (
    <Section title="Schedule" description={dates.length ? "Multi-day event. Ticket types can be valid for every day (a pass, admitted once per day) or for one day only." : "Single-day event. Add a second day to turn it into a multi-day event with passes and per-day tickets."} actions={canEdit ? <DateDialog orgSlug={orgSlug} eventId={eventId} firstExtra={dates.length === 0} /> : null}>
      {dates.length === 0 ? <EmptyState title="One day" description="The start, end and doors times on the Details tab apply." action={canEdit ? <DateDialog orgSlug={orgSlug} eventId={eventId} firstExtra /> : undefined} /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Day</TableHead><TableHead>When</TableHead><TableHead className="text-right">Day-only ticket types</TableHead>{canEdit ? <TableHead /> : null}</TableRow></TableHeader>
          <TableBody>
            {dates.map((d, i) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.label ?? `Day ${i + 1}`}</TableCell>
                <TableCell className="text-muted-foreground">{d.when}</TableCell>
                <TableCell className="text-right tabular-nums">{d.ticketTypes}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right"><div className="flex justify-end gap-1">
                    <DateDialog orgSlug={orgSlug} eventId={eventId} date={d} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><PencilIcon /></Button>} />
                    <ConfirmButton action={deleteEventDate} fields={{ org: orgSlug, event_id: eventId, date_id: d.id }} title={`Remove ${d.label ?? "this day"}?`} description="Ticket types tied only to this day become valid every day. Not possible once tickets for the day are sold." confirmText="Remove" variant="ghost" successText="Day removed">Remove</ConfirmButton>
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
