"use client";

import { useActionState, useState } from "react";
import { PlusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { createVenue, updateVenue, deleteVenue, type ActionState } from "@/lib/events/actions";
import { COMMON_TIMEZONES } from "@/lib/tz";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState } from "@/components/shared";

export interface VenueView { id: number; name: string; address_line1: string | null; address_line2: string | null; city: string | null; region: string | null; postal_code: string | null; country: string; timezone: string; capacity: number | null; tax_bps: number; tax_label: string | null; event_count: number; latitude: number | null; longitude: number | null }

export function VenueDialog({ orgSlug, venue, trigger }: { orgSlug: string; venue?: VenueView; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = venue ? await updateVenue(prev, fd) : await createVenue(prev, fd);
    if (r?.ok) { toast.success(venue ? "Venue updated" : "Venue created"); setOpen(false); }
    return r;
  }, undefined);
  const tzOptions = [...new Set([venue?.timezone ?? "", ...COMMON_TIMEZONES].filter(Boolean))].map((t) => ({ value: t, label: t.replace(/_/g, " ") }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={!trigger} render={trigger ? <span /> : <Button />}>{trigger ?? <><PlusIcon /> Add venue</>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{venue ? `Edit ${venue.name}` : "Add venue"}</DialogTitle><DialogDescription>Tax applies to tickets sold for events at this venue unless the event overrides it. South Carolina admissions tax is 5%.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} />
          {venue ? <input type="hidden" name="venue_id" value={venue.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Venue name" id="v-name" name="name" required defaultValue={venue?.name} autoFocus className="sm:col-span-2" />
            <TextField label="Address" id="v-a1" name="address_line1" defaultValue={venue?.address_line1 ?? ""} />
            <TextField label="Address line 2" id="v-a2" name="address_line2" defaultValue={venue?.address_line2 ?? ""} />
            <TextField label="City" id="v-city" name="city" defaultValue={venue?.city ?? ""} />
            <TextField label="State / region" id="v-region" name="region" defaultValue={venue?.region ?? ""} />
            <TextField label="Postal code" id="v-zip" name="postal_code" defaultValue={venue?.postal_code ?? ""} />
            <TextField label="Country (2-letter)" id="v-country" name="country" maxLength={2} defaultValue={venue?.country ?? "US"} />
            <SelectField label="Time zone" id="v-tz" name="timezone" defaultValue={venue?.timezone ?? "America/New_York"} options={tzOptions} />
            <TextField label="Capacity" id="v-cap" name="capacity" type="number" min={0} defaultValue={venue?.capacity ?? ""} />
            <TextField label="Admissions / sales tax (%)" id="v-tax" name="tax_pct" type="number" step="0.01" min={0} max={30} defaultValue={venue ? (venue.tax_bps / 100).toFixed(2) : "0.00"} />
            <TextField label="Tax label on receipts" id="v-taxl" name="tax_label" placeholder="e.g. SC Admissions Tax" defaultValue={venue?.tax_label ?? ""} />
            <TextField label="Latitude" id="v-lat" name="latitude" inputMode="decimal" placeholder="34.8526" defaultValue={venue?.latitude ?? ""} hint="Optional: lets the homepage show this venue to people nearby" />
            <TextField label="Longitude" id="v-lon" name="longitude" inputMode="decimal" placeholder="-82.3940" defaultValue={venue?.longitude ?? ""} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton pendingText="Saving…">{venue ? "Save changes" : "Add venue"}</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VenuesTable({ orgSlug, venues, canDelete }: { orgSlug: string; venues: VenueView[]; canDelete: boolean }) {
  if (venues.length === 0) return <EmptyState title="No venues yet" description="Add the places where your events happen." action={<VenueDialog orgSlug={orgSlug} />} />;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Venue</TableHead><TableHead>Location</TableHead><TableHead>Time zone</TableHead><TableHead className="text-right">Capacity</TableHead><TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Events</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>
        {venues.map((v) => (
          <TableRow key={v.id}>
            <TableCell className="font-medium">{v.name}</TableCell>
            <TableCell className="text-muted-foreground">{[v.address_line1, v.city, v.region].filter(Boolean).join(", ") || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{v.timezone.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-right tabular-nums">{v.capacity ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{(v.tax_bps / 100).toFixed(2)}%</TableCell>
            <TableCell className="text-right tabular-nums">{v.event_count}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <VenueDialog orgSlug={orgSlug} venue={v} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><PencilIcon /></Button>} />
                {canDelete && v.event_count === 0 ? <ConfirmButton action={deleteVenue} fields={{ org: orgSlug, venue_id: v.id }} title={`Delete ${v.name}?`} description="This cannot be undone." confirmText="Delete" variant="ghost" successText="Venue deleted">Delete</ConfirmButton> : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
