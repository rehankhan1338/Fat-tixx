"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveCampaign } from "@/lib/ads/actions";
import { PLACEMENTS } from "@/lib/ads/placements";
import { CheckField, FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Separator } from "@/components/ui/separator";

export type CampaignValues = {
  id?: number; name: string; kind: string; advertiser_name: string; advertiser_contact: string; destination_url: string;
  starts_at: string; ends_at: string; weight: number; priority: number; event_id: string; placements: string[];
  t_regions: string; t_cities: string; t_age: string; t_signed: string; t_days: string;
};

export const EMPTY_CAMPAIGN: CampaignValues = {
  name: "", kind: "platform", advertiser_name: "", advertiser_contact: "", destination_url: "", starts_at: "", ends_at: "", weight: 1, priority: 0, event_id: "",
  placements: [], t_regions: "", t_cities: "", t_age: "any", t_signed: "any", t_days: "",
};

const TRI = [{ value: "any", label: "Any" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }];

/**
 * Campaign editor shared by the Super Admin (/admin/ads) and organizers (event → Sponsors tab).
 * `scope` limits an organizer to their event and the two sponsor placements.
 */
export function CampaignForm({ values, scope, afterCreateHref }: { values: CampaignValues; scope?: { org: string; event: number }; afterCreateHref?: (id: number) => string }) {
  const [state, action] = useActionState(saveCampaign, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.id && !values.id && afterCreateHref) router.push(afterCreateHref(state.id));
  }, [state, values.id, afterCreateHref, router]);
  const placements = scope ? PLACEMENTS.filter((p) => p.key === "event_detail" || p.key === "order_confirmation") : PLACEMENTS;
  return (
    <form action={action} className="space-y-5">
      <FormStatus state={state} successText={state?.message} />
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {scope ? <><input type="hidden" name="org" value={scope.org} /><input type="hidden" name="event" value={scope.event} /></> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Campaign name" id="c-name" name="name" required maxLength={160} defaultValue={values.name} />
        {!scope ? <SelectField label="Type" id="c-kind" name="kind" defaultValue={values.kind} options={[{ value: "platform", label: "Platform ad (Fat Tixx promotion)" }, { value: "sponsored", label: "Sponsored (brand / partner)" }, { value: "contextual", label: "Contextual (targeted)" }]} /> : null}
        <TextField label="Sponsor / advertiser" id="c-adv" name="advertiser_name" maxLength={160} defaultValue={values.advertiser_name} hint="Shown next to the Sponsored label" />
        <TextField label="Advertiser contact" id="c-contact" name="advertiser_contact" maxLength={255} defaultValue={values.advertiser_contact} hint="Internal only" />
        <TextField label="Destination URL" id="c-url" name="destination_url" type="url" required placeholder="https://" defaultValue={values.destination_url} className="sm:col-span-2" />
        <TextField label="Starts (Eastern time)" id="c-start" name="starts_at" type="datetime-local" defaultValue={values.starts_at} hint="Empty = immediately once active" />
        <TextField label="Ends (Eastern time)" id="c-end" name="ends_at" type="datetime-local" defaultValue={values.ends_at} hint="Empty = no end date" />
        <TextField label="Rotation weight" id="c-weight" name="weight" type="number" min={1} max={100} defaultValue={values.weight} hint="Relative share among campaigns of the same priority" />
        {!scope ? <TextField label="Priority" id="c-priority" name="priority" type="number" min={-100} max={100} defaultValue={values.priority} hint="Higher priority campaigns are shown first" /> : null}
        {!scope ? <TextField label="Only on event ID" id="c-event" name="event_id" type="number" min={1} defaultValue={values.event_id} hint="Optional: limit to one event" /> : null}
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
            </div>
          </fieldset>
        </>
      ) : null}
      <div className="flex justify-end"><SubmitButton pendingText="Saving…">{values.id ? "Save campaign" : "Create campaign"}</SubmitButton></div>
    </form>
  );
}
