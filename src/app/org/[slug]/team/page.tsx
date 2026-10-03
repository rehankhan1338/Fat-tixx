import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { listOrgMembers } from "@/lib/admin/queries";
import { PageHeader, Section } from "@/components/shared";
import { AddMemberDialog, TeamTable } from "@/components/team-members";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({ params }: PageProps<"/org/[slug]/team">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  const members = await listOrgMembers(ctx.org.id);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Team" description="Who can manage events, issue refunds and scan tickets for this organization." actions={<AddMemberDialog orgSlug={slug} />} />
      <Section>
        <TeamTable orgSlug={slug} members={members} currentUserId={ctx.session.user.id} />
      </Section>
    </div>
  );
}
