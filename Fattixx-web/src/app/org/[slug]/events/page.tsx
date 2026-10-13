import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { requireOrg } from "@/lib/authz";
import { listVisibleEvents } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { PageHeader, Section, StatusBadge, EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage({ params, searchParams }: PageProps<"/org/[slug]/events">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  const filter = sp.filter === "past" ? "past" : sp.filter === "all" ? "all" : "upcoming";
  const events = await listVisibleEvents(ctx, filter);
  const canCreate = ctx.role !== "staff";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Events" description={ctx.role === "staff" ? "Events you are assigned to scan." : "Create, publish and manage your events."} actions={canCreate ? <Button render={<Link href={`/org/${slug}/events/new`} />}><PlusIcon /> New event</Button> : null} />
      <Tabs value={filter}>
        <TabsList>
          <TabsTrigger nativeButton={false} value="upcoming" render={<Link href={`/org/${slug}/events`} />}>Upcoming</TabsTrigger>
          <TabsTrigger nativeButton={false} value="past" render={<Link href={`/org/${slug}/events?filter=past`} />}>Past</TabsTrigger>
          <TabsTrigger nativeButton={false} value="all" render={<Link href={`/org/${slug}/events?filter=all`} />}>All</TabsTrigger>
        </TabsList>
      </Tabs>
      <Section>
        {events.length === 0 ? <EmptyState title="No events here" description={canCreate ? "Create an event to start selling tickets." : "Nothing assigned to you in this list."} action={canCreate ? <Button render={<Link href={`/org/${slug}/events/new`} />}><PlusIcon /> New event</Button> : undefined} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sold</TableHead>{ctx.role !== "staff" ? <TableHead className="text-right">Net sales</TableHead> : null}<TableHead className="text-right">Checked in</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link href={`/org/${slug}/events/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                    <span className="block text-xs text-muted-foreground">{e.venue_name ?? "No venue"}{e.visibility !== "public" ? <Badge variant="outline" className="ml-2 text-[10px]">{e.visibility}</Badge> : null}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatEventDate(new Date(e.starts_at), e.timezone)}</TableCell>
                  <TableCell><StatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{e.tickets_sold}/{e.capacity_total}</TableCell>
                  {ctx.role !== "staff" ? <TableCell className="text-right font-mono">{formatCents(Number(e.gross_cents), e.currency)}</TableCell> : null}
                  <TableCell className="text-right tabular-nums">{e.checked_in}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" render={<Link href={`/org/${slug}/events/${e.id}/scan`} />}>Scan</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
