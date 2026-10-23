import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { listVenues } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { orgIsPro } from "@/lib/pro/gate";
import { listOrgRequests, listUsableMaps, REQUEST_STATUS_LABEL, setupFeeCents } from "@/lib/seating/queries";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { ProUpsell } from "@/components/pro/dashboard";
import { FeeLine } from "@/components/seating/request-parts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeatMapRequestForm } from "./request-form";

export const metadata: Metadata = { title: "Seat maps" };

/**
 * Reserved seating (Fattixx Pro, plan 5.7.3–5.7.13): the organization's seat maps, the Venue Library, and requests for
 * new maps. A map is used from an event's Seating tab.
 */
export default async function SeatingPage({ params }: PageProps<"/org/[slug]/seating">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "organizer");
  if (ctx.role === "staff") notFound();
  const header = <PageHeader title="Seat maps" description="Sell numbered seats, tables and sections from an interactive map. Use a map from the Venue Library, or send us your venue's floor plan and we build one for you." />;
  if (!orgIsPro(ctx.org)) {
    return <div className="mx-auto max-w-6xl space-y-6">{header}<ProUpsell ctx={ctx} feature="Reserved seating" text="Buyers pick their exact seat, table or section on an interactive map, with accessible seating marked and every price shown with fees included." /></div>;
  }
  const [maps, requests, venues, fee] = await Promise.all([listUsableMaps(ctx.org.id), listOrgRequests(ctx.org.id), listVenues(ctx.org.id), setupFeeCents()]);
  const own = maps.filter((m) => Number(m.organization_id) === ctx.org.id);
  const library = maps.filter((m) => Number(m.organization_id) !== ctx.org.id);
  const requestFor = (mapId: number) => requests.find((r) => Number(r.seat_map_id) === mapId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {header}
      <Section title="Your seat maps" description="Approved maps built for your venues. Choose one on an event's Seating tab, then price the seats.">
        {own.length === 0 ? <p className="text-sm text-muted-foreground">None yet. Request one below, or use a map from the Venue Library.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Map</TableHead><TableHead className="text-right">Seats</TableHead><TableHead className="text-right">Events</TableHead><TableHead>Approved</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {own.map((m) => {
                const req = requestFor(Number(m.id));
                return (
                  <TableRow key={m.id}>
                    <TableCell><span className="font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{[m.venue_name, m.venue_city].filter(Boolean).join(", ")}{m.in_library ? " · in the Venue Library" : ""}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{m.seat_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.events_using}</TableCell>
                    <TableCell className="text-sm">{formatDate(m.approved_at)}</TableCell>
                    <TableCell className="text-right">{req ? <Link href={`/org/${slug}/seating/${req.id}`} className="text-sm underline">View · request a change</Link> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Venue Library" description="Maps Fattixx has built for venues, free to use for your events there.">
        {library.length === 0 ? <p className="text-sm text-muted-foreground">No library maps yet. If your venue isn’t here, request a map below.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Venue</TableHead><TableHead>Layout</TableHead><TableHead className="text-right">Seats</TableHead></TableRow></TableHeader>
            <TableBody>
              {library.map((m) => (
                <TableRow key={m.id}>
                  <TableCell><span className="font-medium">{m.venue_name}</span><span className="block text-xs text-muted-foreground">{[m.venue_city, m.venue_region].filter(Boolean).join(", ")}</span></TableCell>
                  <TableCell className="text-sm">{m.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.seat_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {requests.length ? (
        <Section title="Requests">
          <Table>
            <TableHeader><TableRow><TableHead>Map</TableHead><TableHead>Status</TableHead><TableHead>Fee</TableHead><TableHead>Requested</TableHead></TableRow></TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/org/${slug}/seating/${r.id}`} className="font-medium hover:underline">{r.map_name}</Link><span className="block text-xs text-muted-foreground">{[r.venue_name, r.venue_city].filter(Boolean).join(", ")}{r.base_map_id ? " · change" : ""}</span></TableCell>
                  <TableCell>{r.status === "awaiting_approval" ? <Link href={`/org/${slug}/seating/${r.id}`} className="text-sm font-semibold text-amber-700 underline">Ready for your approval</Link> : <StatusBadge status={r.status} />}</TableCell>
                  <TableCell className="text-xs"><FeeLine r={r} /></TableCell>
                  <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">{["new", "in_progress", "awaiting_approval", "approved"].map((s) => REQUEST_STATUS_LABEL[s as "new"]).join(" → ")}</p>
        </Section>
      ) : null}

      <Section title="Request a seat map" description={`Send us the venue's floor plan. We build the map, you check it and approve it, and then it's ready for your events.${fee ? ` One-time set-up fee: ${formatCents(fee)}.` : ""}`}>
        <SeatMapRequestForm org={slug} venues={venues.map((v) => ({ id: Number(v.id), name: v.name, city: v.city }))} feeLabel={fee ? formatCents(fee) : null} />
      </Section>
    </div>
  );
}
