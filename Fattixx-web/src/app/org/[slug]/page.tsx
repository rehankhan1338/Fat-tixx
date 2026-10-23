import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { requireOrg } from "@/lib/authz";
import { listVisibleEvents, orgOverview } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { PageHeader, Section, Stat, StatusBadge, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { AdSlot } from "@/components/ad-slot";
import { orgIsPro } from "@/lib/pro/gate";
import { needsPayoutSetup } from "@/lib/payments/payout-reminders";

export const metadata: Metadata = { title: "Overview" };

export default async function OrgOverviewPage({ params, searchParams }: PageProps<"/org/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  // an organizer who signed up on /create answers the sign-up questionnaire first (project plan, "Organizer Sign Up")
  if (ctx.role === "org_admin" && !ctx.org.questionnaire_done_at) redirect(`/org/${slug}/welcome`);
  const [upcoming, overview, payoutsMissing] = await Promise.all([
    listVisibleEvents(ctx, "upcoming"),
    ctx.role === "staff" ? null : orgOverview(ctx.org.id),
    ctx.role === "org_admin" ? needsPayoutSetup(Number(ctx.org.id)) : false,
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={ctx.org.name}
        description={ctx.role === "staff" ? "Your assigned events. Open one to start scanning." : "Sales, events and check-in at a glance."}
        actions={ctx.role !== "staff" ? <Button render={<Link href={`/org/${slug}/events/new`} />}><PlusIcon /> New event</Button> : null}
      />
      {sp.denied ? <Alert variant="destructive"><AlertDescription>Your role does not allow that action.</AlertDescription></Alert> : null}
      {payoutsMissing ? (
        <Alert>
          <AlertDescription>
            Set up payouts to get paid for your ticket sales. <Link href={`/org/${slug}/payouts`} className="font-semibold underline underline-offset-4">Set up payouts</Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Net ticket sales" value={formatCents(overview.grossCents)} hint={`${overview.paidOrders} paid orders`} />
          <Stat label="Tickets sold" value={overview.ticketsSold} hint={`${overview.checkedIn} checked in`} />
          <Stat label="Upcoming events" value={overview.upcoming} hint={`${overview.events} total`} />
          <Stat label="Check-in rate" value={overview.ticketsSold ? `${Math.round((overview.checkedIn / overview.ticketsSold) * 100)}%` : "—"} />
        </div>
      ) : null}

      <Section title="Upcoming events" actions={<Button variant="ghost" size="sm" render={<Link href={`/org/${slug}/events`} />}>All events</Button>}>
        {upcoming.length === 0 ? (
          <EmptyState title="No upcoming events" description={ctx.role === "staff" ? "You have not been assigned to any upcoming event yet." : "Create your first event to start selling tickets."} action={ctx.role !== "staff" ? <Button render={<Link href={`/org/${slug}/events/new`} />}><PlusIcon /> New event</Button> : undefined} />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="w-48">Sold</TableHead><TableHead className="text-right">Checked in</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {upcoming.map((e) => {
                const cap = Number(e.capacity_total) || 0; const sold = Number(e.tickets_sold);
                return (
                  <TableRow key={e.id}>
                    <TableCell><Link href={`/org/${slug}/events/${e.id}`} className="font-medium hover:underline">{e.title}</Link><span className="block text-xs text-muted-foreground">{e.venue_name ?? "No venue"}</span></TableCell>
                    <TableCell className="text-muted-foreground">{formatEventDate(new Date(e.starts_at), e.timezone)}</TableCell>
                    <TableCell><StatusBadge status={e.status} /></TableCell>
                    <TableCell><div className="flex items-center gap-2"><Progress value={cap ? Math.min(100, (sold / cap) * 100) : 0} className="h-2" /><span className="w-20 text-right font-mono text-xs tabular-nums">{sold}/{cap}</span></div></TableCell>
                    <TableCell className="text-right tabular-nums">{e.checked_in}</TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" render={<Link href={`/org/${slug}/events/${e.id}/scan`} />}>Scan</Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>
      {orgIsPro(ctx.org) ? null : <AdSlot placement="org_dashboard" />}
    </div>
  );
}
