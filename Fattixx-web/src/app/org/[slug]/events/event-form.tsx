"use client";

import { useActionState, useState } from "react";
import { createEvent, updateEvent } from "@/lib/events/actions";
import { COMMON_TIMEZONES } from "@/lib/tz";
import { CheckField, FieldWrap, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export interface EventFormValues {
  id?: number; title: string; slug?: string; summary: string; description: string; imageUrl: string | null; venue_id: string; timezone: string;
  starts_at: string; ends_at: string; doors_at: string; capacity: string; visibility: string; age_restriction: string; fee_mode: string;
  tax_pct: string; tax_label: string; refund_policy: string; refund_days_before: string; allow_transfers: boolean; waitlist_enabled: boolean; multiDay?: boolean; category?: string; featured?: boolean;
}
export interface VenueOption { id: number; name: string; timezone: string; tax_bps: number }

/** `categories`: the names managed in Super Admin → Website → Categories. */
export function EventForm({ orgSlug, venues, values, defaultFeeMode, canFeature = false, categories }: { orgSlug: string; venues: VenueOption[]; values?: EventFormValues; defaultFeeMode: string; canFeature?: boolean; categories: string[] }) {
  const categoryOptions = [...new Set([...(values?.category ? [values.category] : []), ...categories])];
  const isEdit = !!values?.id;
  const [state, action] = useActionState(isEdit ? updateEvent : createEvent, undefined);
  const [venueId, setVenueId] = useState(values?.venue_id ?? "");
  const [tz, setTz] = useState(values?.timezone ?? venues[0]?.timezone ?? "America/New_York");
  const [refundPolicy, setRefundPolicy] = useState(values?.refund_policy ?? "no_refunds");
  const venue = venues.find((v) => String(v.id) === venueId);
  const tzOptions = [...new Set([tz, ...venues.map((v) => v.timezone), ...COMMON_TIMEZONES])].map((t) => ({ value: t, label: t.replace(/_/g, " ") }));

  return (
    <form action={action} className="space-y-8">
      <FormStatus state={state} successText="Event saved." />
      <input type="hidden" name="org" value={orgSlug} />
      {isEdit ? <input type="hidden" name="event_id" value={values!.id} /> : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <TextField label="Event title" id="title" name="title" required minLength={3} maxLength={200} defaultValue={values?.title} autoFocus={!isEdit} className="sm:col-span-2" />
        <TextField label="Short summary" id="summary" name="summary" maxLength={300} defaultValue={values?.summary} hint="One sentence shown in listings and link previews." className="sm:col-span-2" />
        <TextAreaField label="Description" id="description" name="description" rows={8} defaultValue={values?.description} className="sm:col-span-2" />
        <FieldWrap label="Event image" htmlFor="image" hint="Landscape works best (e.g. 1600×900). JPG, PNG or WebP up to 8 MB.">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {values?.imageUrl ? <img src={values.imageUrl} alt="" className="h-14 w-24 rounded-md object-cover" /> : null}
            <Input id="image" name="image" type="file" accept="image/*" />
          </div>
          {values?.imageUrl ? <CheckField id="remove_image" name="remove_image" label="Remove current image" /> : null}
        </FieldWrap>
        {isEdit ? <TextField label="URL slug" id="slug" name="slug" defaultValue={values?.slug} hint={`/events/${values?.slug}`} /> : null}
      </section>

      <Separator />
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">When & where</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Venue" id="venue_id" name="venue_id" value={venueId} onChange={(e) => { setVenueId(e.target.value); const v = venues.find((x) => String(x.id) === e.target.value); if (v) setTz(v.timezone); }} options={[{ value: "", label: "— No venue / online —" }, ...venues.map((v) => ({ value: String(v.id), label: v.name }))]} hint={venue ? `Venue tax: ${(venue.tax_bps / 100).toFixed(2)}%` : "Add venues under Venues."} />
          <SelectField label="Time zone" id="timezone" name="timezone" value={tz} onChange={(e) => setTz(e.target.value)} options={tzOptions} />
          {values?.multiDay ? <p className="text-sm text-muted-foreground sm:col-span-2">This is a multi-day event: dates, end times and doors are managed on the <strong>Schedule</strong> tab.</p> : null}
          <TextField label="Starts" id="starts_at" name="starts_at" type="datetime-local" required defaultValue={values?.starts_at} readOnly={values?.multiDay} />
          <TextField label="Ends" id="ends_at" name="ends_at" type="datetime-local" defaultValue={values?.ends_at} readOnly={values?.multiDay} />
          <TextField label="Doors open" id="doors_at" name="doors_at" type="datetime-local" defaultValue={values?.doors_at} readOnly={values?.multiDay} />
          <TextField label="Overall capacity" id="capacity" name="capacity" type="number" min={1} defaultValue={values?.capacity} hint="Optional. Ticket quantities also limit sales." />
        </div>
      </section>

      <Separator />
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Visibility & rules</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Visibility" id="visibility" name="visibility" defaultValue={values?.visibility ?? "public"} options={[{ value: "public", label: "Public — listed on Fat Tixx" }, { value: "unlisted", label: "Unlisted — not listed, anyone with the link" }, { value: "private", label: "Private — only via a secret link (key in the URL)" }]} hint="Presale / access codes for individual ticket types are set on each ticket type." />
          <SelectField label="Category" id="category" name="category" defaultValue={values?.category ?? ""} options={[{ value: "", label: "No category" }, ...categoryOptions.map((c) => ({ value: c, label: c }))]} hint="Used by the category filters on the homepage." />
          {canFeature ? <><input type="hidden" name="featured_present" value="1" /><CheckField id="featured" name="featured" label="Feature on the homepage" hint="Super Admin: shows this event in the homepage featured strip." defaultChecked={values?.featured} /></> : null}
          <TextField label="Age restriction" id="age_restriction" name="age_restriction" type="number" min={0} max={99} placeholder="e.g. 21" defaultValue={values?.age_restriction} hint="Shown at purchase and prompts an ID check at the door." />
          <SelectField label="Refund policy" id="refund_policy" name="refund_policy" value={refundPolicy} onChange={(e) => setRefundPolicy(e.target.value)} options={[{ value: "no_refunds", label: "No refunds (except cancellation)" }, { value: "until_event_start", label: "Attendees may request a refund until the event starts" }, { value: "days_before", label: "Attendees may request a refund up to N days before" }]} />
          {refundPolicy === "days_before" ? <TextField label="Days before event" id="refund_days_before" name="refund_days_before" type="number" min={1} max={365} defaultValue={values?.refund_days_before || "7"} /> : <div />}
          <CheckField id="allow_transfers" name="allow_transfers" label="Allow attendees to transfer tickets" defaultChecked={values?.allow_transfers} />
          <CheckField id="waitlist_enabled" name="waitlist_enabled" label="Waitlist when sold out" hint="Buyers can leave their email when a ticket type sells out; you release tickets to them from the Waitlist tab." defaultChecked={values ? values.waitlist_enabled : true} />
          {isEdit ? <p className="text-xs text-muted-foreground sm:col-span-2">Checkout questions and add-ons (parking, merchandise) are managed on the <strong>Checkout</strong> tab.</p> : null}
        </div>
      </section>

      <Separator />
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Fees & tax</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Who pays platform & processing fees" id="fee_mode" name="fee_mode" defaultValue={values?.fee_mode ?? defaultFeeMode} options={[{ value: "buyer_pays", label: "Buyer pays (added to the all-in price shown up front)" }, { value: "organizer_absorbs", label: "Organizer absorbs (deducted from your payout)" }]} />
          <TextField label="Tax override (%)" id="tax_pct" name="tax_pct" type="number" step="0.01" min={0} max={30} defaultValue={values?.tax_pct} placeholder={venue ? `Venue rate ${(venue.tax_bps / 100).toFixed(2)}%` : "0.00"} hint="Leave blank to use the venue's rate." />
          <TextField label="Tax label" id="tax_label" name="tax_label" maxLength={80} placeholder="e.g. SC Admissions Tax" defaultValue={values?.tax_label} />
        </div>
      </section>

      <div className="flex justify-end">
        <SubmitButton pendingText="Saving…">{isEdit ? "Save changes" : "Create event as draft"}</SubmitButton>
      </div>
    </form>
  );
}
