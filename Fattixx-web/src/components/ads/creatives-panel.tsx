"use client";

import { useActionState } from "react";
import { useClearOnSuccess } from "@/components/form-validation";
import { addCreative, deleteCreative } from "@/lib/ads/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CreativeView = { id: number; imageUrl: string | null; alt_text: string; headline: string | null; body: string | null };

/** Upload and preview ad creatives. Images are re-encoded to WebP and resized, keeping pages fast on mobile (plan 13.1). */
export function CreativesPanel({ campaignId, creatives, scope }: { campaignId: number; creatives: CreativeView[]; scope?: { org: string; event: number } }) {
  const [state, action] = useActionState(addCreative, undefined);
  const form = useClearOnSuccess(state);
  const scopeFields: Record<string, string | number> = scope ? { org: scope.org, event: scope.event } : {};
  return (
    <div className="space-y-4">
      {creatives.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {creatives.map((c) => (
            <li key={c.id} className="space-y-2 rounded-lg border p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded WebP preview */}
              {c.imageUrl ? <img src={c.imageUrl} alt={c.alt_text} className="max-h-40 w-full rounded object-cover" /> : null}
              {c.headline ? <p className="font-medium">{c.headline}</p> : null}
              {c.body ? <p className="text-sm text-muted-foreground">{c.body}</p> : null}
              <p className="text-xs text-muted-foreground">Alt text: {c.alt_text}</p>
              <ConfirmButton action={deleteCreative} fields={{ creative_id: c.id, ...scopeFields }} title="Remove this creative?" confirmText="Remove" variant="ghost">Remove</ConfirmButton>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No creatives yet. A campaign needs at least one before it can go live.</p>}
      <form ref={form} action={action} className="space-y-3 rounded-lg border border-dashed p-4">
        <FormStatus state={state} />
        <input type="hidden" name="campaign_id" value={campaignId} />
        {scope ? <><input type="hidden" name="org" value={scope.org} /><input type="hidden" name="event" value={scope.event} /></> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor={`cr-img-${campaignId}`}>Image</Label><Input id={`cr-img-${campaignId}`} name="image" type="file" accept="image/jpeg,image/png,image/webp" /></div>
          <TextField label="Alt text" id={`cr-alt-${campaignId}`} name="alt_text" required maxLength={200} hint="What the image shows, for screen readers" />
          <TextField label="Headline" id={`cr-head-${campaignId}`} name="headline" maxLength={120} />
          <TextField label="Short text" id={`cr-body-${campaignId}`} name="body" maxLength={300} />
        </div>
        <div className="flex justify-end"><SubmitButton size="sm" pendingText="Uploading…">Add creative</SubmitButton></div>
      </form>
    </div>
  );
}
