"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { acceptReferralInvite } from "@/lib/social/referral-actions";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";

export function AcceptInviteForm({ token }: { token: string }) {
  const [terms, setTerms] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (url) {
    return (
      <div className="space-y-3 text-sm">
        <p>Your personal link:</p>
        <div className="flex items-center gap-2"><code className="truncate rounded bg-muted px-2 py-1">{url}</code><CopyButton value={url} label="Copy" /></div>
        <p className="text-muted-foreground">Track clicks, sales and earnings in <Link href="/account/referrals" className="underline">Referral rewards</Link>, and set up your payout details there.</p>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => { const r = await acceptReferralInvite(token, terms); if (r?.url) setUrl(r.url); else setError(r?.error ?? "Couldn’t accept."); }); }}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required className="mt-1" />
        <span>I agree to the <Link href="/referral-terms" target="_blank" className="underline">Referral Rewards Terms</Link>, including saying that I earn a reward whenever I promote this event.</span>
      </label>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending || !terms}>{pending ? "Creating your link…" : "Accept and get my link"}</Button>
    </form>
  );
}
