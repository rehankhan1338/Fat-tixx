import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { getSeatMap, listApprovedMaps, listMapChanges, mapAutosave, mapLayout } from "@/lib/seating/queries";
import { staffCopyLayout, staffDeleteMap, staffMapToDraft } from "@/lib/seating/actions";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { SeatMapEditor } from "@/components/seating/SeatMapEditor";
import { ChangeLog, FloorPlan } from "@/components/seating/request-parts";
import { RunButton, SelectRun } from "@/components/seating/request-forms";
import { ConfirmButton } from "@/components/confirm-button";
import { PublishMapForm } from "./publish-form";

export const metadata: Metadata = { title: "Seat map" };

/**
 * A seat map a Super Admin builds without an organizer's request (Admin → Seat maps → New seat map): the builder, then
 * Publish. A published map goes back to draft only while no event uses it. Maps built for a request open their request.
 */
export default async function StaffSeatMapPage({ params }: PageProps<"/admin/seating/maps/[id]">) {
  await requirePlatformStaff(["super_admin"]);
  const map = await getSeatMap(Number((await params).id));
  if (!map) notFound();
  if (map.request_id) redirect(`/admin/seating/${map.request_id}`);
  const [changes, approved] = await Promise.all([listMapChanges(Number(map.id)), listApprovedMaps()]);
  const draft = map.status === "draft";
  const f = { map_id: Number(map.id) };
  const plan = map.floor_plan_kind === "image" ? uploadUrl(map.floor_plan_path) : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{map.name} <StatusBadge status={draft ? "draft" : map.status === "approved" ? "published" : map.status} /></span>}
        description={<>
          {map.org_slug ? <>For <Link href={`/admin/organizations/${map.org_slug}`} className="underline">{map.org_name}</Link></> : "Venue Library map"} · {[map.venue_name, map.venue_city, map.venue_region].filter(Boolean).join(", ")} · #{map.id} · built by Fattixx staff, started {formatDate(map.created_at)}
        </>}
        actions={<Link href="/admin/seating" className="text-sm underline">All seat maps</Link>}
      />

      <Section title="Next step">
        {draft ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">Save the builder, then publish. {map.organization_id ? `${map.org_name} can use the map on their events once it is published.` : "Every Pro organizer can use it once it is published."}</p>
            <PublishMapForm mapId={Number(map.id)} forOrg={map.org_name} />
            <div><ConfirmButton action={staffDeleteMap} fields={f} title="Delete this draft map?" description="The map and its change history are deleted. This can’t be undone." confirmText="Delete map" variant="ghost" size="xs">Delete this draft</ConfirmButton></div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Published {formatDate(map.approved_at)}{map.in_library ? " and listed in the Venue Library" : ""}. Used by {map.events_using} event{Number(map.events_using) === 1 ? "" : "s"}.</span>
            {Number(map.events_using) ? <span className="text-muted-foreground">Events keep their own copy of the seats, so it stays published.</span>
              : <RunButton action={staffMapToDraft} fields={f}>Back to draft to change it</RunButton>}
          </div>
        )}
      </Section>

      <Section title={`Builder · map #${map.id}`} description={draft ? "Add rows and tables, drag them into place, take out seats for aisles and mark accessible seats. Changes are autosaved; Save adds them to the change history." : "Published maps are read only. Move it back to draft to change it."}>
        <SeatMapEditor target={f} mapName={map.name} initial={mapLayout(map)} editable={draft} floorPlanUrl={plan} autosaved={draft ? mapAutosave(map) : null} />
        {draft && approved.length ? (
          <div className="mt-4 border-t pt-4">
            <SelectRun action={staffCopyLayout} fields={f} name="from_map_id" label="Start from an approved map (replaces the draft)" submit="Copy layout"
              options={approved.map((m) => ({ value: String(m.id), label: `${m.name} · ${m.venue_name} (${m.seat_count} seats, #${m.id})` }))} />
          </div>
        ) : null}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Floor plan"><FloorPlan r={map} /></Section>
        <Section title="Change history" description="Every save of the builder, with what changed."><ChangeLog changes={changes} /></Section>
      </div>
    </div>
  );
}
