import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon } from "lucide-react";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/authz";
import { listOrgMembers } from "@/lib/admin/queries";
import { listOrgEvents, orgOverview } from "@/lib/events/queries";
import { getSettings } from "@/lib/settings";
import { formatCents } from "@/lib/money";
import { PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddMemberDialog, TeamTable } from "@/components/team-members";
import { InviteLinkNotice } from "@/components/invite-link-notice";
import { OrgPlatformSettingsForm } from "./platform-settings-form";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteOrganization } from "@/lib/admin/crud-actions";
import { formatEventDate } from "@/lib/tz";

export const metadata: Metadata = { title: "Organization" };

export default async function AdminOrganizationPage({ params, searchParams }: PageProps<"/admin/organizations/[slug]">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const isSuper = hasPlatformRole(session, "super_admin");
  const { slug } = await params;
  const sp = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const [members, events, overview, settings] = await Promise.all([listOrgMembers(org.id), listOrgEvents(org.id), orgOverview(org.id), getSettings()]);
  const invite = typeof sp.invite === "string" && sp.invite.startsWith("http") ? sp.invite : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3">{org.name} <StatusBadge status={org.status} /></span>}
        description={<>/{org.slug} · {org.contact_email}{org.website ? <> · <a href={org.website} className="hover:underline" target="_blank" rel="noreferrer">{org.website}</a></> : null}</>}
        actions={<Button variant="outline" render={<Link href={`/org/${org.slug}`} />}><ExternalLinkIcon /> Open organization panel</Button>}
      />
      {invite ? <InviteLinkNotice link={invite} message="The Organization Admin was invited. Until SMTP is configured, share this password link with them directly." /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross sales" value={formatCents(overview.grossCents)} hint={`${overview.paidOrders} paid orders`} />
        <Stat label="Tickets sold" value={overview.ticketsSold} hint={`${overview.checkedIn} checked in`} />
        <Stat label="Events" value={overview.events} hint={`${overview.upcoming} upcoming`} />
        <Stat label="Team" value={members.length} />
      </div>

      <Tabs defaultValue="team">
        <TabsList>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="platform">Fees & status</TabsTrigger>
        </TabsList>
        <TabsContent value="team" className="pt-4">
          <Section title="Team members" description="Roles and permissions apply to this organization only." actions={<AddMemberDialog orgSlug={org.slug} />}>
            <TeamTable orgSlug={org.slug} members={members} currentUserId={session.user.id} />
          </Section>
        </TabsContent>
        <TabsContent value="events" className="pt-4">
          <Section title="Events">
            {events.length === 0 ? <p className="text-sm text-muted-foreground">No events yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Gross</TableHead></TableRow></TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell><Link href={`/org/${org.slug}/events/${e.id}`} className="font-medium hover:underline">{e.title}</Link></TableCell>
                      <TableCell className="text-muted-foreground">{formatEventDate(new Date(e.starts_at), e.timezone)}</TableCell>
                      <TableCell><StatusBadge status={e.status} /></TableCell>
                      <TableCell className="text-right tabular-nums">{e.tickets_sold}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(Number(e.gross_cents), e.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="platform" className="pt-4">
          <Section title="Platform fees & status" description={`Platform default: ${(Number(settings.platform_fee_bps) / 100).toFixed(2)}% + ${formatCents(Number(settings.platform_fee_fixed_cents))} per ticket. Leave blank to use the default.`}>
            {isSuper ? <OrgPlatformSettingsForm orgSlug={org.slug} feeBps={org.fee_bps_override} feeFixedCents={org.fee_fixed_cents_override} status={org.status} /> : <p className="text-sm text-muted-foreground">Fee override: {org.fee_bps_override ?? "default"} bps, fixed {org.fee_fixed_cents_override ?? "default"} cents. Only a Super Admin can change these.</p>}
          </Section>
          <p className="mt-4 text-xs text-muted-foreground">Created {formatDate(org.created_at)}.</p>
          {isSuper ? (
            <Section title="Danger zone" description="Deleting an organization removes its venues, events, orders, tickets and team memberships permanently. No refunds are issued; cancel events first if buyers must be refunded." className="mt-6 border-destructive/40">
              <ConfirmButton action={deleteOrganization} fields={{ org: org.slug }} title={`Delete ${org.name}?`} description={`This removes ${overview.events} event(s) and ${overview.paidOrders} paid order(s) and cannot be undone.`} confirmText="Delete organization" variant="destructive" size="default">Delete organization</ConfirmButton>
            </Section>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
