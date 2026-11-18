import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { queryOne, type Row } from "@/lib/db";
import { sha256 } from "@/lib/security/crypto";
import { rewardLabel } from "@/lib/social/referrals";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Referral invitation", robots: { index: false, follow: false } };

/* An organizer's invite-only referral offer (11.9): sign in, accept the terms, get a personal link. */
export default async function AcceptReferralPage({ params }: PageProps<"/referrals/accept/[token]">) {
  const { token } = await params;
  const r = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await queryOne<Row & { status: string; event_title: string; org_name: string; currency: string; reward_type: "fixed" | "percent"; reward_basis: "ticket" | "order"; reward_value: number; invite_email: string | null }>(
    `SELECT r.status, e.title AS event_title, o.name AS org_name, e.currency, f.reward_type, f.reward_basis, f.reward_value, r.invite_email
       FROM referrers r JOIN referral_offers f ON f.id = r.offer_id JOIN events e ON e.id = f.event_id JOIN organizations o ON o.id = f.organization_id
      WHERE r.invite_token_hash = ?`, [sha256(token)],
  ) : null;
  if (!r || r.status === "removed") {
    return <AuthShell title="Invitation not valid" subtitle="This invitation link is incomplete, was already used, or the organizer withdrew it."><p className="text-sm">Ask the organizer for a new invitation.</p></AuthShell>;
  }
  const session = await getSession();
  const here = `/referrals/accept/${token}`;
  return (
    <AuthShell title={`Promote ${r.event_title}`} subtitle={<>{r.org_name} invited you to earn <b>{rewardLabel(r, r.currency)}</b> for tickets sold through your personal link. Rewards are paid after the event ends.</>}>
      {session ? (
        <AcceptInviteForm token={token} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button render={<Link href={`/login?next=${encodeURIComponent(here)}`} />}>Sign in</Button>
          <Button variant="outline" render={<Link href={`/register?next=${encodeURIComponent(here)}${r.invite_email ? `&email=${encodeURIComponent(r.invite_email)}` : ""}`} />}>Create an account</Button>
        </div>
      )}
    </AuthShell>
  );
}
