"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveCampaign } from "@/lib/ads/actions";
import { ADVERTISER_PLACEMENTS, PLACEMENTS, TICKET_KINDS, VIEWER_ROLES } from "@/lib/ads/placements";
import { CheckField, FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Separator } from "@/components/ui/separator";

export type CampaignValues = {
  id?: number; name: string; kind: string; advertiser_name: string; advertiser_contact: string; destination_url: string;
  starts_at: string; ends_at: string; weight: number; priority: number; event_id: string; placements: string[];
  t_regions: string; t_cities: string; t_age: string; t_signed: string; t_days: string;
  t_categories: string[]; t_kinds: string[]; t_roles: string[];
};

export const EMPTY_CAMPAIGN: CampaignValues = {
  name: "", kind: "platform", advertiser_name: "", advertiser_contact: "", destination_url: "", starts_at: "", ends_at: "", weight: 1, priority: 0, event_id: "",
  placements: [], t_regions: "", t_cities: "", t_age: "any", t_signed: "any", t_days: "", t_categories: [], t_kinds: [], t_roles: [],
};

const TRI = [{ value: "any", label: "Any" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }];

/** A row of small checkboxes; none ticked = no restriction. */
function ChipGroup({ legend, hint, options }: { legend: string; hint: string; options: { name: string; value?: string; label: string; checked: boolean }[] }) {
  return (
    <fieldset className="space-y-1.5 sm:col-span-2">
      <legend className="text-sm font-medium">{legend} <span className="font-normal text-muted-foreground">({hint})</span></legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={`${o.name}-${o.value ?? ""}`} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm hover:bg-accent/40 has-checked:border-primary has-checked:bg-primary/5">
            <input type="checkbox" name={o.name} value={o.value ?? "1"} defaultChecked={o.checked} className="size-4 accent-[var(--primary)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Campaign editor shared by the Super Admin (/admin/ads), organizers (event → Sponsors tab) and self-service advertisers
 * (/advertiser). `scope` limits an organizer to their event and the two sponsor placements; `advertiser` limits an
 * advertiser to the attendee-facing placements, with targeting but without the platform's own settings.
 */
export function CampaignForm({ values, scope, advertiser = false, afterCreateHref, categories = [] }: { values: CampaignValues; scope?: { org: string; event: number }; advertiser?: boolean; afterCreateHref?: (id: number) => string; categories?: string[] }) {
  const [state, action] = useActionState(saveCampaign, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.id && !values.id && afterCreateHref) router.push(afterCreateHref(state.id));
  }, [state, values.id, afterCreateHref, router]);
  const placements = scope ? PLACEMENTS.filter((p) => p.key === "event_detail" || p.key === "order_confirmation")
    : advertiser ? PLACEMENTS.filter((p) => (ADVERTISER_PLACEMENTS as readonly string[]).includes(p.key)) : PLACEMENTS;
  const platform = !scope && !advertiser;
  return (
    <form action={action} className="space-y-5">
      <FormStatus state={state} successText={state?.message} />
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {scope ? <><input type="hidden" name="org" value={scope.org} /><input type="hidden" name="event" value={scope.event} /></> : null}
      {advertiser ? <input type="hidden" name="advertiser" value="1" /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Campaign name" id="c-name" name="name" required maxLength={160} defaultValue={values.name} />
        {platform ? <SelectField label="Type" id="c-kind" name="kind" defaultValue={values.kind} options={[{ value: "platform", label: "Platform ad (Fattixx promotion)" }, { value: "sponsored", label: "Sponsored (brand / partner)" }, { value: "contextual", label: "Contextual (targeted)" }]} /> : null}
        {!advertiser ? <TextField label="Sponsor / advertiser" id="c-adv" name="advertiser_name" maxLength={160} defaultValue={values.advertiser_name} hint="Shown next to the Sponsored label" /> : null}
        {!advertiser ? <TextField label="Advertiser contact" id="c-contact" name="advertiser_contact" maxLength={255} defaultValue={values.advertiser_contact} hint="Internal only" /> : null}
        <TextField label="Destination URL" id="c-url" name="destination_url" type="url" required placeholder="https://" defaultValue={values.destination_url} className="sm:col-span-2" />
        <TextField label="Starts (Eastern time)" id="c-start" name="starts_at" type="datetime-local" defaultValue={values.starts_at} hint="Empty = immediately once active" />
        <TextField label="Ends (Eastern time)" id="c-end" name="ends_at" type="datetime-local" defaultValue={values.ends_at} hint="Empty = no end date" />
        {!advertiser ? <TextField label="Rotation weight" id="c-weight" name="weight" type="number" min={1} max={100} defaultValue={values.weight} hint="Relative share among campaigns of the same priority" /> : null}
        {platform ? <TextField label="Priority" id="c-priority" name="priority" type="number" min={-100} max={100} defaultValue={values.priority} hint="Higher priority campaigns are shown first" /> : null}
        {platform ? <TextField label="Only on event ID" id="c-event" name="event_id" type="number" min={1} defaultValue={values.event_id} hint="Optional: limit to one event" /> : null}
      </div>
      <Separator />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Placements</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {placements.map((p) => <CheckField key={p.key} id={`pl-${p.key}`} name={`pl_${p.key}`} label={p.label} hint={p.description} defaultChecked={values.placements.includes(p.key)} />)}
        </div>
      </fieldset>
      {!scope ? (
        <>
          <Separator />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Targeting <span className="font-normal text-muted-foreground">(leave empty to show everywhere)</span></legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Venue states / regions" id="t-regions" name="t_regions" placeholder="SC, NC" defaultValue={values.t_regions} />
              <TextField label="Venue cities" id="t-cities" name="t_cities" placeholder="Charleston, Columbia" defaultValue={values.t_cities} />
              <SelectField label="Age-restricted events only" id="t-age" name="t_age" defaultValue={values.t_age} options={TRI} />
              <SelectField label="Signed-in visitors only" id="t-signed" name="t_signed" defaultValue={values.t_signed} options={TRI} />
              <TextField label="Within N days before the event" id="t-days" name="t_days" type="number" min={1} max={365} defaultValue={values.t_days} />
              {/* Categories no longer in the list stay selectable so an edit does not silently drop them. */}
              {[...new Set([...categories, ...values.t_categories])].length ? (
                <ChipGroup legend="Event categories" hint="any ticked category"
                  options={[...new Set([...categories, ...values.t_categories])].map((c) => ({ name: "t_category", value: c, label: c, checked: values.t_categories.includes(c) }))} />
              ) : null}
              <ChipGroup legend="Ticket types" hint="the visitor's own tickets on order pages, emails and the ticket dashboard; otherwise the event's ticket types"
                options={TICKET_KINDS.map((k) => ({ name: `t_kind_${k.key}`, label: k.label, checked: values.t_kinds.includes(k.key) }))} />
              <ChipGroup legend="Visitor role" hint="any ticked role"
                options={VIEWER_ROLES.map((r) => ({ name: `t_role_${r.key}`, label: r.label, checked: values.t_roles.includes(r.key) }))} />
            </div>
          </fieldset>
        </>
      ) : null}
      <div className="flex justify-end"><SubmitButton pendingText="Saving…">{values.id ? "Save campaign" : "Create campaign"}</SubmitButton></div>
    </form>
  );
}
