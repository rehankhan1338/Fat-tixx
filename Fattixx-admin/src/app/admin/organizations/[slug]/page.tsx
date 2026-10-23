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
import { adminReleaseDomain } from "@/lib/pro/actions";
import { getOrgDomain } from "@/lib/pro/domains";
import { orgProState } from "@/lib/pro/subscription";
import { ProCompForm } from "./pro-comp-form";
import { WhiteLabelForm } from "./white-label-form";
import { orgIsPro } from "@/lib/pro/gate";
import { getActiveStripe } from "@/lib/payments/stripe";
import { connectState, getConnectAccount, parseDue } from "@/lib/payments/connect";

export const metadata: Metadata = { title: "Organization" };

export default async function AdminOrganizationPage({ params, searchParams }: PageProps<"/admin/organizations/[slug]">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const isSuper = hasPlatformRole(session, "super_admin");
  const { slug } = await params;
  const sp = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const active = await getActiveStripe();
  const [members, events, overview, settings, pro, domain, connect] = await Promise.all([listOrgMembers(org.id), listOrgEvents(org.id), orgOverview(org.id), getSettings(), orgProState(org), getOrgDomain(org.id), active ? getConnectAccount(org.id, active.mode) : null]);
  const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-US", { dateStyle: "long" }) : "—");
  const proText: Record<string, string> = {
    none: "Standard plan.", pending: "Checkout started, not paid.", ended: "Pro has ended.", lapsed: "Payment failed and the grace period is over: Pro is off.",
    active: pro.state.kind === "active" ? `Active, billed ${pro.state.interval === "year" ? "yearly" : "monthly"}; renews ${day(pro.state.renews)}.` : "",
    canceling: pro.state.kind === "canceling" ? `Cancelled; Pro ends ${day(pro.state.until)}.` : "",
    grace: pro.state.kind === "grace" ? `Payment failed; Pro stays on until ${day(pro.state.until)}.` : "",
    comp: pro.state.kind === "comp" ? `Complimentary until ${day(pro.state.until)}.` : "",
  };
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
          <TabsTrigger value="pro">Fattixx Pro</TabsTrigger>
        </TabsList>
        <TabsContent value="pro" className="space-y-6 pt-4">
          <Section title="Plan" description={proText[pro.state.kind]}>
            {pro.sub ? (
              <p className="text-sm text-muted-foreground">
                Stripe ({pro.sub.stripe_mode}): customer <span className="font-mono">{pro.sub.stripe_customer_id ?? "—"}</span>, subscription <span className="font-mono">{pro.sub.stripe_subscription_id ?? "—"}</span>, status {pro.sub.status}.
              </p>
            ) : null}
            {isSuper ? <div className="mt-4"><ProCompForm orgSlug={org.slug} until={org.pro_comp_until ? new Date(org.pro_comp_until).toISOString().slice(0, 10) : ""} /></div> : null}
          </Section>
          <Section title="Custom domain" description={domain ? `${domain.hostname}: ${domain.status}, TXT ${domain.txt_ok ? "ok" : "missing"}, DNS ${domain.dns_ok ? "ok" : "not pointing here"}, certificate ${domain.ssl_status.replace("_", " ")}. Last checked ${formatDate(domain.checked_at)}.` : "None."}>
            {domain?.last_error ? <p className="text-sm text-destructive">{domain.last_error}</p> : null}
            {domain && isSuper ? (
              <ConfirmButton action={adminReleaseDomain} fields={{ org: org.slug }} title={`Release ${domain.hostname}?`} description="The organization loses this domain at once and another organization can claim it with its own DNS records. Use for domain disputes." confirmText="Release domain">Release domain</ConfirmButton>
            ) : null}
          </Section>
          <Section title="White-label" description={org.white_label ? (orgIsPro(org) ? "On." : "On, but inactive while the organization is not on Pro.") : "Off."}>
            {isSuper ? <WhiteLabelForm orgSlug={org.slug} on={!!org.white_label} /> : null}
          </Section>
          <Section title="Stripe Connect payouts" description={connect ? `${connect.stripe_mode} account ${connect.account_id}: ${connectState(connect).replace("_", " ")}${connect.disabled_reason ? ` (${connect.disabled_reason})` : ""}. Last synced ${formatDate(connect.synced_at)}.` : "No Stripe account; paid manually through Admin → Payouts."}>
            {connect && parseDue(connect.requirements_due).length ? <p className="text-sm text-muted-foreground">Stripe needs: {parseDue(connect.requirements_due).join(", ")}</p> : null}
          </Section>
        </TabsContent>
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
