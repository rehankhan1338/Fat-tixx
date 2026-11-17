"use client";

import { useActionState } from "react";
import { saveOrgSocial, type OrgSocialState } from "@/lib/social/org-actions";
import { CheckField, FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

const NETWORKS = [
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/yourpage" },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@yourpage" },
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/yourpage" },
  { key: "x", label: "X", placeholder: "https://x.com/yourpage" },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@yourpage" },
] as const;

/** Social links on the public organizer page and the follower-count switch (Social & Community 11.5). */
export function OrgSocialForm({ slug, links, hideCount }: { slug: string; links: Record<string, string>; hideCount: boolean }) {
  const [state, action] = useActionState<OrgSocialState, FormData>(saveOrgSocial, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={slug} />
      <div className="grid gap-4 sm:grid-cols-2">
        {NETWORKS.map((n) => <TextField key={n.key} label={n.label} id={`soc-${n.key}`} name={`social_${n.key}`} defaultValue={links[n.key] ?? ""} placeholder={n.placeholder} maxLength={255} />)}
      </div>
      <CheckField id="soc-hide" name="hide_follower_count" defaultChecked={hideCount} label="Hide my follower count on my organizer page" />
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
