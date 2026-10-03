"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { DownloadIcon, MailIcon, PlusIcon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";
import type { AttendeeRow } from "@/lib/orders/queries";
import { emailAttendees, issueStaffOrder, type ActionState } from "@/lib/orders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge, Section, EmptyState } from "@/components/shared";

type EventInfo = { id: number; title: string; timezone: string; status: string };

function csvEscape(v: unknown): string { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

const STATUS_FILTERS = [
  { value: "active", label: "Active tickets" },
  { value: "not_checked_in", label: "Not checked in" },
  { value: "checked_in", label: "Checked in" },
  { value: "transferred", label: "Transferred (old tickets)" },
  { value: "void", label: "Cancelled / refunded" },
  { value: "all", label: "All statuses" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

function matchesStatus(s: string, f: StatusFilter): boolean {
  switch (f) {
    case "active": return s === "valid" || s === "used";
    case "not_checked_in": return s === "valid";
    case "checked_in": return s === "used";
    case "transferred": return s === "transferred";
    case "void": return s === "cancelled" || s === "refunded";
    default: return true;
  }
}

export function AttendeesPanel({ orgSlug, event, attendees, canEdit, ticketTypes, transfers = [] }: { orgSlug: string; event: EventInfo; attendees: AttendeeRow[]; canEdit: boolean; canRefund: boolean; ticketTypes?: { id: number; name: string }[]; transfers?: TransferView[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [type, setType] = useState("");
  const [day, setDay] = useState("");
  const [source, setSource] = useState("");
  const typeNames = useMemo(() => [...new Set(attendees.map((a) => a.ticket_type_name))].sort(), [attendees]);
  const dayNames = useMemo(() => [...new Set(attendees.map((a) => a.day_label).filter((d): d is string => !!d))], [attendees]);
  const sources = useMemo(() => [...new Set(attendees.map((a) => a.source))], [attendees]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return attendees.filter((a) =>
      matchesStatus(a.ticket_status, status)
      && (!type || a.ticket_type_name === type)
      && (!day || (day === "__pass" ? !a.day_label : a.day_label === day))
      && (!source || a.source === source)
      && (!needle || [a.attendee_name, a.attendee_email, a.buyer_email, a.buyer_name, a.order_code, a.ticket_code, a.ticket_type_name].some((v) => v?.toLowerCase().includes(needle))));
  }, [attendees, q, status, type, day, source]);
  const isFiltered = !!(q.trim() || status !== "active" || type || day || source);

  /** Exports exactly the rows currently shown (all filters applied). */
  function downloadCsv() {
    const header = ["Ticket code", "Attendee", "Attendee email", "Ticket type", "Valid day", "Seat", "Status", "Checked in at", "Checked in by", "Order", "Buyer", "Buyer email", "Source", "Received by transfer", "Add-ons"];
    const rows = filtered.map((a) => [a.ticket_code, a.attendee_name, a.attendee_email, a.ticket_type_name, a.day_label ?? "", a.seat_label, a.ticket_status, a.checked_in_at ? new Date(a.checked_in_at).toISOString() : "", a.checked_in_by_name, a.order_code, a.buyer_name, a.buyer_email, a.source, a.transferred_from_id ? "yes" : "", a.addons ?? ""]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-attendees${isFiltered ? "-filtered" : ""}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  // Matches emailAttendees: buyers of paid orders plus people holding a live ticket by transfer.
  const broadcastCount = useMemo(() => new Set([
    ...attendees.filter((a) => ["paid", "partially_refunded"].includes(a.order_status)).map((a) => a.buyer_email.toLowerCase()),
    ...attendees.filter((a) => a.transferred_from_id && a.attendee_email && ["valid", "used"].includes(a.ticket_status)).map((a) => a.attendee_email!.toLowerCase()),
  ]).size, [attendees]);

  function clearFilters() { setQ(""); setStatus("active"); setType(""); setDay(""); setSource(""); }
  const doorListQuery = new URLSearchParams({ ...(type ? { type } : {}), ...(day ? { day } : {}), ...(status === "not_checked_in" ? { status: "not_checked_in" } : {}) }).toString();

  return (
    <div className="space-y-6">
    <Section
      title="Attendees"
      description="Everyone holding a ticket. The CSV export and door list follow the filters you set here."
      actions={
        <div className="flex flex-wrap gap-2">
          {canEdit ? <BroadcastDialog orgSlug={orgSlug} eventId={event.id} count={broadcastCount} /> : null}
          {canEdit && ticketTypes ? <IssueTicketsDialog orgSlug={orgSlug} eventId={event.id} ticketTypes={ticketTypes} /> : null}
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!filtered.length}><DownloadIcon /> CSV{isFiltered ? ` (${filtered.length})` : ""}</Button>
          <Button variant="outline" size="sm" render={<Link href={`/org/${orgSlug}/events/${event.id}/door-list${doorListQuery ? `?${doorListQuery}` : ""}`} target="_blank" />}><PrinterIcon /> Door list</Button>
        </div>
      }
    >
      {attendees.length === 0 ? <EmptyState title="No attendees yet" description="Tickets appear here as soon as orders are paid or issued." /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, order or ticket code" className="w-full sm:max-w-xs" />
            <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              {STATUS_FILTERS.map((s) => <NativeSelectOption key={s.value} value={s.value}>{s.label}</NativeSelectOption>)}
            </NativeSelect>
            {typeNames.length > 1 ? (
              <NativeSelect aria-label="Filter by ticket type" value={type} onChange={(e) => setType(e.target.value)}>
                <NativeSelectOption value="">All ticket types</NativeSelectOption>
                {typeNames.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
              </NativeSelect>
            ) : null}
            {dayNames.length ? (
              <NativeSelect aria-label="Filter by day" value={day} onChange={(e) => setDay(e.target.value)}>
                <NativeSelectOption value="">All days</NativeSelectOption>
                {dayNames.map((d) => <NativeSelectOption key={d} value={d}>{d}</NativeSelectOption>)}
                <NativeSelectOption value="__pass">Passes (every day)</NativeSelectOption>
              </NativeSelect>
            ) : null}
            {sources.length > 1 ? (
              <NativeSelect aria-label="Filter by source" value={source} onChange={(e) => setSource(e.target.value)}>
                <NativeSelectOption value="">All sources</NativeSelectOption>
                {sources.map((s) => <NativeSelectOption key={s} value={s}>{s.replace("_", " ")}</NativeSelectOption>)}
              </NativeSelect>
            ) : null}
            {isFiltered ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button> : null}
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Attendee</TableHead><TableHead>Ticket</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead>Checked in</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.ticket_id}>
                  <TableCell><span className="font-medium">{a.attendee_name ?? a.buyer_name ?? "—"}</span><span className="block text-xs text-muted-foreground">{a.attendee_email ?? a.buyer_email}</span></TableCell>
                  <TableCell>{a.ticket_type_name}{a.day_label ? <span className="ml-1 text-xs text-muted-foreground">· {a.day_label}</span> : null}{a.seat_label ? <span className="block text-xs text-muted-foreground">{a.seat_label}</span> : null}<span className="block font-mono text-[11px] text-muted-foreground">{a.ticket_code}</span></TableCell>
                  <TableCell><Link href={`/org/${orgSlug}/orders/${a.order_code}`} className="font-mono text-xs hover:underline">{a.order_code}</Link>{a.source !== "online" ? <span className="block text-[11px] text-muted-foreground">{a.source.replace("_", " ")}</span> : null}{a.addons ? <span className="block text-[11px] text-muted-foreground">+ {a.addons}</span> : null}</TableCell>
                  <TableCell><StatusBadge status={a.ticket_status} />{a.transferred_from_id ? <span className="mt-1 block text-[11px] text-muted-foreground">via transfer</span> : null}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.checked_in_at ? `${new Date(a.checked_in_at).toLocaleTimeString()}${a.checked_in_by_name ? ` · ${a.checked_in_by_name}` : ""}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No tickets match these filters.</p> : null}
          <p className="text-xs text-muted-foreground">{filtered.length} of {attendees.length} tickets</p>
        </div>
      )}
    </Section>
    {canEdit ? <TransfersSection orgSlug={orgSlug} transfers={transfers} /> : null}
    </div>
  );
}

export type TransferView = { id: number; created_at: string; order_code: string; from_ticket_code: string; to_ticket_code: string; to_ticket_status: string; from_name: string | null; from_email: string | null; to_name: string; to_email: string; initiated_by: "holder" | "staff"; actor_name: string | null; note: string | null };

function TransfersSection({ orgSlug, transfers }: { orgSlug: string; transfers: TransferView[] }) {
  return (
    <Section title={`Ticket transfers (${transfers.length})`} description="Every transfer voids the old ticket and issues a new one to the recipient. Transfer a ticket yourself from its order page.">
      {transfers.length === 0 ? <p className="text-sm text-muted-foreground">No tickets have been transferred for this event.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Tickets</TableHead><TableHead>Order</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
          <TableBody>
            {transfers.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(x.created_at).toLocaleString()}</TableCell>
                <TableCell>{x.from_name ?? "—"}<span className="block text-xs text-muted-foreground">{x.from_email}</span></TableCell>
                <TableCell>{x.to_name}<span className="block text-xs text-muted-foreground">{x.to_email}</span></TableCell>
                <TableCell className="font-mono text-xs">{x.from_ticket_code} → {x.to_ticket_code} <StatusBadge status={x.to_ticket_status} /></TableCell>
                <TableCell><Link href={`/org/${orgSlug}/orders/${x.order_code}`} className="font-mono text-xs hover:underline">{x.order_code}</Link></TableCell>
                <TableCell className="text-xs">{x.initiated_by === "staff" ? `Staff${x.actor_name ? ` · ${x.actor_name}` : ""}` : "Ticket holder"}{x.note ? <span className="block text-muted-foreground">“{x.note}”</span> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

function BroadcastDialog({ orgSlug, eventId, count }: { orgSlug: string; eventId: number; count: number }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await emailAttendees(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Sent"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={!count} />}><MailIcon /> Email attendees</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Email all ticket holders</DialogTitle><DialogDescription>Sent to {count} buyer{count === 1 ? "" : "s"} as an event update (transactional, not marketing).</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          <TextField label="Subject" id="bc-subject" name="subject" required placeholder="Doors open earlier" />
          <TextAreaField label="Message" id="bc-body" name="body" rows={6} required />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Sending…">Send to {count}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IssueTicketsDialog({ orgSlug, eventId, ticketTypes }: { orgSlug: string; eventId: number; ticketTypes: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await issueStaffOrder(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Issued"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><PlusIcon /> Issue tickets</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Issue tickets</DialogTitle><DialogDescription>Complimentary tickets (free) or a box-office sale paid at the door. Tickets are emailed to the attendee immediately.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          <SelectField label="Type" id="is-source" name="source" defaultValue="complimentary" options={[{ value: "complimentary", label: "Complimentary (no charge)" }, { value: "box_office", label: "Box office / door sale (cash or card taken in person)" }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Attendee name" id="is-name" name="name" required />
            <TextField label="Attendee email" id="is-email" name="email" type="email" required />
            <SelectField label="Ticket type" id="is-tt" name="ticket_type_id" options={ticketTypes.map((t) => ({ value: String(t.id), label: t.name }))} />
            <TextField label="Quantity" id="is-qty" name="quantity" type="number" min={1} max={50} defaultValue={1} />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Issuing…">Issue & email tickets</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
