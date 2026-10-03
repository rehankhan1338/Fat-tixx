"use client";

import { useActionState, useState } from "react";
import { PackagePlusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { createAddon, updateAddon, deleteAddon, type ActionState } from "@/lib/events/actions";
import { formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckField, FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState, Section } from "@/components/shared";

export interface AddonView { id: number; name: string; description: string | null; price_cents: number; quantity: number | null; sold: number; held: number; max_per_order: number; active: boolean; sort_order: number }

function AddonDialog({ orgSlug, eventId, addon, trigger }: { orgSlug: string; eventId: number; addon?: AddonView; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = addon ? await updateAddon(prev, fd) : await createAddon(prev, fd);
    if (r?.ok) { toast.success(addon ? "Add-on updated" : "Add-on added"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={!trigger} render={trigger ? <span /> : <Button />}>{trigger ?? <><PackagePlusIcon /> Add add-on</>}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{addon ? `Edit ${addon.name}` : "Add an add-on"}</DialogTitle><DialogDescription>Parking, merchandise, drink packages… Sold with tickets; no QR code. Buyers show their order number to collect.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          {addon ? <input type="hidden" name="addon_id" value={addon.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" id="ad-name" name="name" required defaultValue={addon?.name} placeholder="Parking pass" autoFocus className="sm:col-span-2" />
            <TextField label="Price ($)" id="ad-price" name="price" inputMode="decimal" placeholder="15.00" defaultValue={addon ? (addon.price_cents / 100).toFixed(2) : ""} hint="Service fee % and tax apply; no fixed per-ticket fee." />
            <TextField label="Quantity available" id="ad-qty" name="quantity" type="number" min={0} defaultValue={addon?.quantity ?? ""} hint="Blank = unlimited" />
            <TextField label="Max per order" id="ad-max" name="max_per_order" type="number" min={1} max={100} defaultValue={addon?.max_per_order ?? 10} />
            <TextField label="Display order" id="ad-sort" name="sort_order" type="number" min={0} defaultValue={addon?.sort_order ?? 0} />
            <TextAreaField label="Description" id="ad-desc" name="description" rows={2} maxLength={500} defaultValue={addon?.description ?? ""} className="sm:col-span-2" />
            <CheckField id="ad-active" name="active" label="Available for purchase" defaultChecked={addon ? addon.active : true} />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Saving…">{addon ? "Save changes" : "Add add-on"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddonsPanel({ orgSlug, eventId, currency, canEdit, addons }: { orgSlug: string; eventId: number; currency: string; canEdit: boolean; addons: AddonView[] }) {
  return (
    <Section title="Add-ons" description="Extras buyers can add to a ticket order: parking, merchandise, VIP upgrades." actions={canEdit ? <AddonDialog orgSlug={orgSlug} eventId={eventId} /> : null}>
      {addons.length === 0 ? <EmptyState title="No add-ons" description="Add-ons appear below the ticket list once a buyer picks a ticket." action={canEdit ? <AddonDialog orgSlug={orgSlug} eventId={eventId} /> : undefined} /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Add-on</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Available</TableHead>{canEdit ? <TableHead /> : null}</TableRow></TableHeader>
          <TableBody>
            {addons.map((a) => (
              <TableRow key={a.id}>
                <TableCell><span className="font-medium">{a.name}</span>{!a.active ? <Badge variant="outline" className="ml-2 text-[10px]">inactive</Badge> : null}{a.description ? <span className="block max-w-xs truncate text-xs text-muted-foreground">{a.description}</span> : null}</TableCell>
                <TableCell className="text-right font-mono">{a.price_cents ? formatCents(a.price_cents, currency) : "Free"}</TableCell>
                <TableCell className="text-right tabular-nums">{a.sold}{a.held ? <span className="text-xs text-muted-foreground"> (+{a.held} held)</span> : null}</TableCell>
                <TableCell className="text-right tabular-nums">{a.quantity == null ? "Unlimited" : <>{Math.max(0, a.quantity - a.sold - a.held)} <span className="text-xs text-muted-foreground">/ {a.quantity}</span></>}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right"><div className="flex justify-end gap-1">
                    <AddonDialog orgSlug={orgSlug} eventId={eventId} addon={a} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><PencilIcon /></Button>} />
                    {a.sold === 0 ? <ConfirmButton action={deleteAddon} fields={{ org: orgSlug, event_id: eventId, addon_id: a.id }} title={`Delete ${a.name}?`} confirmText="Delete" variant="ghost" successText="Deleted">Delete</ConfirmButton> : null}
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
