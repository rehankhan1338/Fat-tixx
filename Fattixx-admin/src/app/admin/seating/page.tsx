import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { listApprovedMaps, requestQueue, requestQueueCounts, REQUEST_STATUSES, type RequestStatus } from "@/lib/seating/queries";
import { staffSetLibrary } from "@/lib/seating/actions";
import { PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { FeeLine } from "@/components/seating/request-parts";
import { RunButton } from "@/components/seating/request-forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Seat maps" };

/**
 * Reserved seating (plan 5.7.3–5.7.13): organizers' seat map requests, oldest first, and the Venue Library of approved
 * maps. Staff build each map from the uploaded floor plan in the builder on the request page.
 */
export default async function SeatingQueuePage({ searchParams }: PageProps<"/admin/seating">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const filter = (["open", "all", ...REQUEST_STATUSES] as string[]).includes(String(sp.status)) ? (String(sp.status) as RequestStatus | "open" | "all") : "open";
  const [rows, counts, library] = await Promise.all([requestQueue(filter), requestQueueCounts(), listApprovedMaps()]);
  const filters: [string, string][] = [["open", "Open"], ["new", "New"], ["in_progress", "In progress"], ["awaiting_approval", "With the organizer"], ["approved", "Approved"], ["cancelled", "Cancelled"], ["all", "All"]];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Seat maps" description="Requests from Fattixx Pro organizers: build the map from their floor plan, send it for approval, and list finished maps in the Venue Library." />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="New" value={counts.new} hint="Not started" />
        <Stat label="In progress" value={counts.in_progress} />
        <Stat label="With the organizer" value={counts.awaiting_approval} hint="Awaiting approval" />
        <Stat label="Venue Library" value={library.filter((m) => m.in_library).length} hint={`${library.length} approved maps in all`} />
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {filters.map(([k, label]) => <Link key={k} href={`/admin/seating?status=${k}`} className={filter === k ? "font-semibold underline" : "underline-offset-2 hover:underline"}>{label}</Link>)}
      </div>
      <Section title="Requests">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Map</TableHead><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead>Fee</TableHead><TableHead>Assigned</TableHead><TableHead>Requested</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/admin/seating/${r.id}`} className="font-medium hover:underline">{r.map_name}</Link>
                    <span className="block text-xs text-muted-foreground">{[r.venue_name, r.venue_city].filter(Boolean).join(", ")}{r.base_map_id ? " · change to an existing map" : ""}{r.map_seat_count ? ` · ${r.map_seat_count} seats` : ""}</span>
                  </TableCell>
                  <TableCell className="text-sm"><Link href={`/admin/organizations/${r.org_slug}`} className="hover:underline">{r.org_name}</Link></TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-xs"><FeeLine r={r} /></TableCell>
                  <TableCell className="text-sm">{r.assignee_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section title="Venue Library" description="Approved maps. A listed map can be used by every Pro organizer for events at that venue, free of charge; unlisted maps only by the organization they were built for.">
        {library.length === 0 ? <p className="text-sm text-muted-foreground">No approved maps yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Map</TableHead><TableHead>Built for</TableHead><TableHead className="text-right">Seats</TableHead><TableHead className="text-right">Events</TableHead><TableHead>Library</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {library.map((m) => (
                <TableRow key={m.id}>
                  <TableCell><span className="font-medium">{m.name}</span><span className="block text-xs text-muted-foreground">{[m.venue_name, m.venue_city, m.venue_region].filter(Boolean).join(", ")} · #{m.id}</span></TableCell>
                  <TableCell className="text-sm">{m.org_name ?? "Fattixx"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.seat_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.events_using}</TableCell>
                  <TableCell>{m.in_library ? <StatusBadge status="published" /> : <span className="text-xs text-muted-foreground">Not listed</span>}</TableCell>
                  <TableCell className="text-right">
                    <RunButton action={staffSetLibrary} fields={{ map_id: m.id, listed: m.in_library ? 0 : 1 }} size="xs" success={m.in_library ? "Taken out of the library" : "Listed in the library"}>
                      {m.in_library ? "Unlist" : "List in library"}
                    </RunButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
