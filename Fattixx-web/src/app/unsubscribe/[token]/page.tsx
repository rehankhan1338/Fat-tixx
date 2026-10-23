import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { unsubscribeInfo } from "@/lib/pro/email-marketing";
import { UnsubscribeForm } from "./unsubscribe-form";

/*
 * Unsubscribe from an organizer's marketing emails (Fattixx Pro, plan 5.7.2), from the link in every campaign email.
 * Confirmed with a button rather than on opening, so mail scanners that open links never unsubscribe anyone.
 */
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default async function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;
  if (token === "preview") {
    return <AuthShell title="Unsubscribe" subtitle="This is the unsubscribe link of a test email. In the real email, it unsubscribes the recipient."><p className="text-sm">Nothing to do here.</p></AuthShell>;
  }
  const info = await unsubscribeInfo(token);
  if (!info) {
    return <AuthShell title="Link not valid" subtitle="This unsubscribe link is incomplete or has expired. Use the link in the most recent email you received."><p className="text-sm">If you keep receiving emails you did not ask for, reply to one of them and ask to be removed.</p></AuthShell>;
  }
  return (
    <AuthShell title={`Unsubscribe from ${info.orgName}`} subtitle={<>Stop marketing emails from {info.orgName} to <b>{info.email}</b>. You will still get your tickets, receipts and updates about events you have tickets for.</>}>
      {info.already ? <p className="text-sm">You are already unsubscribed. {info.orgName} will not send you marketing emails.</p> : <UnsubscribeForm token={token} orgName={info.orgName} />}
    </AuthShell>
  );
}
