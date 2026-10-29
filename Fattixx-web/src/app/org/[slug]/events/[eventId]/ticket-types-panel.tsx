"use client";

import { useActionState, useState } from "react";
import { PlusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { createTicketType, updateTicketType, deleteTicketType, type ActionState } from "@/lib/events/actions";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState, Section } from "@/components/shared";

export interface TicketTypeView { id: number; name: string; description: string | null; kind: string; price_cents: number; quantity: number; sold: number; held: number; min_per_order: number; max_per_order: number; max_per_account: number | null; seats_per_unit: number; sales_start_at: string; sales_end_at: string; hidden: boolean; access_code: string | null; event_date_id: number | null; sort_order: number; seated?: number | boolean }
export interface DayOption { id: number; label: string }

const KIND_OPTIONS = [
  { value: "general", label: "General Admission" }, { value: "vip", label: "VIP" }, { value: "table", label: "Table (one QR code per seat)" }, { value: "complimentary", label: "Complimentary (free, hidden from public)" },
];

function TicketTypeDialog({ orgSlug, eventId, tt, trigger, days = [] }: { orgSlug: string; eventId: number; tt?: TicketTypeView; trigger?: React.ReactNode; days?: DayOption[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(tt?.kind ?? "general");
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = tt ? await updateTicketType(prev, fd) : await createTicketType(prev, fd);
    if (r?.ok) { toast.success(r.message ?? (tt ? "Ticket type updated" : "Ticket type added")); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={!trigger} render={trigger ? <span /> : <Button />}>{trigger ?? <><PlusIcon /> Add ticket type</>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{tt ? `Edit ${tt.name}` : "Add ticket type"}</DialogTitle><DialogDescription>Prices are shown to buyers all-in (with fees and tax) as required by the FTC rule.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          {tt ? <input type="hidden" name="ticket_type_id" value={tt.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" id="tt-name" name="name" required defaultValue={tt?.name} placeholder="General Admission" autoFocus />
            <SelectField label="Kind" id="tt-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} options={tt?.seated ? KIND_OPTIONS.filter((o) => o.value !== "table") : KIND_OPTIONS} />
            {kind !== "complimentary" ? <TextField label="Price ($)" id="tt-price" name="price" inputMode="decimal" placeholder="25.00" defaultValue={tt ? (tt.price_cents / 100).toFixed(2) : ""} hint="Enter 0 for free tickets." /> : <div />}
            {tt?.seated
              ? <TextField label="Seats" id="tt-qty" name="quantity" type="number" readOnly defaultValue={tt.quantity} hint="Reserved seating: the seats assigned to this tier on the Seating tab." />
              : <TextField label={kind === "table" ? "Number of tables" : "Quantity available"} id="tt-qty" name="quantity" type="number" min={1} required defaultValue={tt?.quantity} />}
            {kind === "table" ? <TextField label="Seats per table" id="tt-seats" name="seats_per_unit" type="number" min={1} max={50} defaultValue={tt?.seats_per_unit ?? 8} hint="Each seat gets its own QR code." /> : null}
            <TextField label="Min per order" id="tt-min" name="min_per_order" type="number" min={1} max={100} defaultValue={tt?.min_per_order ?? 1} />
            <TextField label="Max per order" id="tt-max" name="max_per_order" type="number" min={1} max={100} defaultValue={tt?.max_per_order ?? 10} />
            <TextField label="Limit per person" id="tt-max-acct" name="max_per_account" type="number" min={1} max={1000} defaultValue={tt?.max_per_account ?? ""} hint="Across all orders by the same email or account. Blank = no limit." />
            <TextField label="Sales start" id="tt-start" name="sales_start_at" type="datetime-local" defaultValue={tt?.sales_start_at} hint="Blank = as soon as published" />
            <TextField label="Sales end" id="tt-end" name="sales_end_at" type="datetime-local" defaultValue={tt?.sales_end_at} hint="Blank = until the event starts" />
            <TextField label="Display order" id="tt-sort" name="sort_order" type="number" min={0} defaultValue={tt?.sort_order ?? 0} />
            {days.length ? <SelectField label="Valid for" id="tt-day" name="event_date_id" defaultValue={tt?.event_date_id ? String(tt.event_date_id) : ""} options={[{ value: "", label: "Every day (multi-day pass)" }, ...days.map((d) => ({ value: String(d.id), label: `${d.label} only` }))]} hint="Passes are admitted once per day." /> : null}
            <TextAreaField label="Description" id="tt-desc" name="description" rows={2} maxLength={500} defaultValue={tt?.description ?? ""} className="sm:col-span-2" />
            {kind !== "complimentary" ? <TextField label="Access / presale code" id="tt-code" name="access_code" maxLength={40} defaultValue={tt?.access_code ?? ""} placeholder="e.g. EARLYBIRD" className="[&_input]:font-mono [&_input]:uppercase" hint="Buyers who enter this code on the event page see this ticket. Leave blank for a normal ticket." /> : null}
            {kind !== "complimentary" ? <CheckField id="tt-hidden" name="hidden" label="Hidden" hint="Not shown on the public page; used for door sales, comps or presales." defaultChecked={tt?.hidden} /> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton pendingText="Saving…">{tt ? "Save changes" : "Add ticket type"}</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TicketTypesPanel({ orgSlug, eventId, currency, canEdit, ticketTypes, days = [] }: { orgSlug: string; eventId: number; timezone: string; currency: string; canEdit: boolean; ticketTypes: TicketTypeView[]; days?: DayOption[] }) {
  const dayName = (id: number | null) => days.find((d) => d.id === id)?.label ?? null;
  return (
    <Section title="Ticket types" description="Inventory is enforced on every checkout; tickets can never be oversold." actions={canEdit ? <TicketTypeDialog orgSlug={orgSlug} eventId={eventId} days={days} /> : null}>
      {ticketTypes.length === 0 ? <EmptyState title="No ticket types yet" description="Add General Admission, VIP, tables or complimentary tickets." action={canEdit ? <TicketTypeDialog orgSlug={orgSlug} eventId={eventId} days={days} /> : undefined} /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Kind</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Held</TableHead><TableHead className="text-right">Available</TableHead><TableHead>Sales window</TableHead>{canEdit ? <TableHead /> : null}</TableRow></TableHeader>
          <TableBody>
            {ticketTypes.map((t) => (
              <TableRow key={t.id}>
                <TableCell><span className="font-medium">{t.name}</span>{t.access_code ? <Badge variant="outline" className="ml-2 font-mono text-[10px]">code: {t.access_code}</Badge> : t.hidden ? <Badge variant="outline" className="ml-2 text-[10px]">hidden</Badge> : null}{days.length ? <Badge variant="secondary" className="ml-2 text-[10px]">{dayName(t.event_date_id) ?? "all days"}</Badge> : null}{t.description ? <span className="block max-w-xs truncate text-xs text-muted-foreground">{t.description}</span> : null}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{t.seated ? <Badge variant="secondary" className="normal-case">Reserved seating</Badge> : <>{t.kind}{t.kind === "table" ? ` · ${t.seats_per_unit} seats` : ""}</>}</TableCell>
                <TableCell className="text-right font-mono">{t.price_cents ? formatCents(t.price_cents, currency) : "Free"}</TableCell>
                <TableCell className="text-right tabular-nums">{t.sold}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{t.held}</TableCell>
                <TableCell className="text-right tabular-nums">{Math.max(0, t.quantity - t.sold - t.held)} <span className="text-xs text-muted-foreground">/ {t.quantity}</span></TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.sales_start_at || t.sales_end_at ? `${t.sales_start_at || "now"} → ${t.sales_end_at || "event start"}` : "Always"}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right"><div className="flex justify-end gap-1">
                    <TicketTypeDialog orgSlug={orgSlug} eventId={eventId} tt={t} days={days} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><PencilIcon /></Button>} />
                    {t.sold === 0 ? <ConfirmButton action={deleteTicketType} fields={{ org: orgSlug, event_id: eventId, ticket_type_id: t.id }} title={`Delete ${t.name}?`} confirmText="Delete" variant="ghost" successText="Deleted">Delete</ConfirmButton> : null}
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
