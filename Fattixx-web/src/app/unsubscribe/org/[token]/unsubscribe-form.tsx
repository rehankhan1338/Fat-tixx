"use client";

import { useState, useTransition } from "react";
import { unsubscribeFromOrg } from "@/lib/social/org-actions";
import { Button } from "@/components/ui/button";

export function OrgUnsubscribeForm({ token }: { token: string }) {
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) return <p className="text-sm">{done}</p>;
  return (
    <Button disabled={pending} onClick={() => start(async () => { const r = await unsubscribeFromOrg(token); setDone(r?.ok ? "You’re unsubscribed." : r?.error ?? "Something went wrong."); })}>
      {pending ? "Unsubscribing…" : "Unsubscribe"}
    </Button>
  );
}
