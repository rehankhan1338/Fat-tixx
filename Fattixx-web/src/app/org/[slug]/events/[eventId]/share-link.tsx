"use client";

import { LinkIcon } from "lucide-react";
import { rotatePrivateKey } from "@/lib/events/actions";
import { CopyButton } from "@/components/copy-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** The shareable link for private (key-protected) and unlisted events. */
export function ShareLink({ orgSlug, eventId, url, visibility, canEdit }: { orgSlug: string; eventId: number; url: string; visibility: "private" | "unlisted"; canEdit: boolean }) {
  return (
    <Alert>
      <LinkIcon />
      <AlertTitle>{visibility === "private" ? "Private event — share this link" : "Unlisted event — share this link"}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{visibility === "private" ? "Only people with this exact link (it contains a secret key) can open the event page or buy tickets. It is not listed or indexed." : "Not listed on Fat Tixx or indexed by search engines; anyone with the link can buy."}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-xs">{url}</code>
          <CopyButton value={url} label="Copy link" />
          {visibility === "private" && canEdit ? <ConfirmButton action={rotatePrivateKey} fields={{ org: orgSlug, event_id: eventId }} title="Generate a new private link?" description="The current link stops working immediately for everyone you shared it with." confirmText="Generate new link" variant="outline" successText="New link generated">New link</ConfirmButton> : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
