import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { audienceUnsubInfo } from "@/lib/social/org-actions";
import { OrgUnsubscribeForm } from "./unsubscribe-form";

/* Unsubscribe from an organizer's audience messages (Social & Community 11.10). Confirmed with a button, so mail scanners never unsubscribe anyone. */
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default async function OrgUnsubscribePage({ params }: PageProps<"/unsubscribe/org/[token]">) {
  const { token } = await params;
  const info = await audienceUnsubInfo(token);
  if (!info) return <AuthShell title="Link not valid" subtitle="This unsubscribe link is incomplete. Use the link in the most recent email you received."><p className="text-sm">Nothing changed.</p></AuthShell>;
  return (
    <AuthShell title={`Unsubscribe from ${info.orgName}`} subtitle={<>Stop messages from {info.orgName} to <b>{info.email}</b>. You will still get your tickets, receipts and updates about events you have tickets for.</>}>
      <OrgUnsubscribeForm token={token} />
    </AuthShell>
  );
}
