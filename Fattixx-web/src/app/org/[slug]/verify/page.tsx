import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/authz";
import { queryOne, type Row } from "@/lib/db";
import { verificationState } from "@/lib/orgs/verification";
import { PageHeader, Section } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify your organization" };

/**
 * Verification for an organization made on /create (src/lib/orgs/verification.ts): the same details as the "Start
 * hosting" application, filled in from what the organizer already gave, plus a password when the account has none.
 */
export default async function VerifyPage({ params }: PageProps<"/org/[slug]/verify">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  const [state, user, last] = await Promise.all([
    verificationState(ctx.org),
    queryOne<Row & { name: string; email: string; phone: string | null; password_hash: string | null }>(`SELECT name, email, phone, password_hash FROM users WHERE id = ?`, [ctx.session.user.id]),
    queryOne<Row & { contact_name: string; contact_phone: string | null; legal_name: string; business_type: string; tax_id_last4: string | null; website: string | null; address: string | null; expected_events: string | null }>(
      `SELECT contact_name, contact_phone, legal_name, business_type, tax_id_last4, website, address, expected_events FROM organizer_applications WHERE organization_id = ? ORDER BY id DESC LIMIT 1`, [ctx.org.id],
    ),
  ]);

  if (state.verified || state.pending) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="Verification" />
        <Alert>
          <AlertTitle>{state.verified ? `${ctx.org.name} is verified.` : "Your verification is in review."}</AlertTitle>
          <AlertDescription>
            {state.verified
              ? "You can sell paid tickets."
              : `Most reviews take one to two business days. We will email you the result${state.heldEvents ? `, and your ${state.heldEvents === 1 ? "paid event goes" : `${state.heldEvents} paid events go`} live as soon as it is approved` : ""}.`}
          </AlertDescription>
        </Alert>
        <Button variant="outline" render={<Link href={`/org/${slug}/events`} />}>Back to events</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Verify your organization"
        description="We verify every organizer before their first paid event, which protects buyers and you. Free events don’t need it. Most reviews take one to two business days."
      />
      {state.rejectedNotes ? (
        <Alert variant="destructive">
          <AlertTitle>Your last verification wasn’t approved.</AlertTitle>
          <AlertDescription>{state.rejectedNotes} Update your details below and send them again.</AlertDescription>
        </Alert>
      ) : null}
      {state.heldEvents ? (
        <Alert>
          <AlertDescription>
            {state.heldEvents === 1 ? "Your paid event is" : `${state.heldEvents} paid events are`} saved and in review: only your team can see {state.heldEvents === 1 ? "it" : "them"} until your organization is verified.
          </AlertDescription>
        </Alert>
      ) : null}
      <Section>
        <VerifyForm
          org={slug}
          orgName={ctx.org.name}
          needsPassword={!user?.password_hash}
          defaults={{
            contactName: last?.contact_name ?? user?.name ?? "",
            email: user?.email ?? ctx.org.contact_email,
            phone: last?.contact_phone ?? ctx.org.contact_phone ?? user?.phone ?? "",
            legalName: last?.legal_name ?? ctx.org.legal_name ?? "",
            businessType: last?.business_type ?? "company",
            taxLast4: last?.tax_id_last4 ?? "",
            website: last?.website ?? ctx.org.website ?? "",
            address: last?.address ?? ctx.org.mailing_address ?? "",
            events: last?.expected_events ?? ctx.org.description ?? "",
          }}
        />
      </Section>
    </div>
  );
}
