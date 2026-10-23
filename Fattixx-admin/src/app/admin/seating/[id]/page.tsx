import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { getSeatMap, getSeatMapRequest, listApprovedMaps, listMapChanges, listRequestNotes, mapLayout } from "@/lib/seating/queries";
import {
  noteFromStaff, staffAssign, staffCancel, staffCopyLayout, staffSendForApproval, staffSetFee, staffStartRequest, staffTakeBack,
} from "@/lib/seating/actions";
import { feeSettled } from "@/lib/seating/fee";
import { isProActive } from "@/lib/pro/status";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { SeatMapEditor } from "@/components/seating/SeatMapEditor";
import { ChangeLog, FeeLine, FloorPlan, NotesThread, RequestSteps } from "@/components/seating/request-parts";
import { MessageForm, RunButton, SelectRun } from "@/components/seating/request-forms";

export const metadata: Metadata = { title: "Seat map request" };

/** One seat map request: the organizer's floor plan and notes, the builder, the conversation and the map's change history. */
export default async function SeatingRequestPage({ params }: PageProps<"/admin/seating/[id]">) {
  const session = await requirePlatformStaff(["super_admin", "support"]);
  const r = await getSeatMapRequest(Number((await params).id));
  if (!r) notFound();
  const [notes, map, approved] = await Promise.all([listRequestNotes(r.id), r.seat_map_id ? getSeatMap(Number(r.seat_map_id)) : null, listApprovedMaps()]);
  const changes = map ? await listMapChanges(Number(map.id)) : [];
  const editable = r.status === "in_progress" && map?.status === "draft";
  const f = { request_id: r.id };
  const plan = r.floor_plan_kind === "image" ? uploadUrl(r.floor_plan_path) : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{r.map_name} <StatusBadge status={r.status} /></span>}
        description={<>
          <Link href={`/admin/organizations/${r.org_slug}`} className="underline">{r.org_name}</Link>{isProActive(r.org_pro_until) ? " (Pro)" : " (not on Pro)"} · {[r.venue_name, r.venue_city].filter(Boolean).join(", ")} · requested {formatDate(r.created_at)} by {r.creator_name ?? "—"}
          {r.base_map_id ? <> · change to <strong>{r.base_map_name}</strong> (#{r.base_map_id})</> : null}
        </>}
        actions={<Link href="/admin/seating" className="text-sm underline">All requests</Link>}
      />
      <RequestSteps status={r.status} />

      <Section title="Next step">
        <div className="flex flex-wrap items-center gap-2">
          {r.status === "new" || (r.status === "in_progress" && !map) ? <RunButton action={staffStartRequest} fields={f} variant="default" success="Started">{r.status === "new" ? "Start work" : "Create the draft map"}</RunButton> : null}
          {r.status === "awaiting_approval" ? <RunButton action={staffTakeBack} fields={f} success="Back in progress">Take back to make changes</RunButton> : null}
          {r.assigned_to && Number(r.assigned_to) === session.user.id
            ? <RunButton action={staffAssign} fields={{ ...f, to: "none" }} variant="ghost">Unassign me</RunButton>
            : <RunButton action={staffAssign} fields={{ ...f, to: "me" }} variant="ghost">Assign to me</RunButton>}
          <span className="text-sm text-muted-foreground">Assigned: {r.assignee_name ?? "nobody"}</span>
        </div>
        {editable ? (
          <div className="mt-4 max-w-2xl">
            <MessageForm action={staffSendForApproval} fields={f} label="Send to the organizer for approval (optional note)" submit="Send for approval" required={false} rows={2} />
          </div>
        ) : null}
        {r.status === "awaiting_approval" ? <p className="mt-3 text-sm text-muted-foreground">Waiting for the organizer to approve it or ask for changes. Sent {formatDate(r.sent_for_approval_at)}.</p> : null}
        {r.status === "approved" ? <p className="mt-3 text-sm text-muted-foreground">Approved {formatDate(r.approved_at)}. List it in the Venue Library from the <Link href="/admin/seating?status=approved" className="underline">Seat maps</Link> page if other organizers should be able to use it.</p> : null}
      </Section>

      {map ? (
        <Section title={`Builder · map #${map.id}`} description={editable ? "Trace the floor plan: add rows and tables, drag them into place, take out seats for aisles and mark accessible seats. Save often; each save is logged." : `This map is ${map.status === "draft" ? "not editable right now" : map.status}.`}>
          <SeatMapEditor requestId={r.id} mapName={map.name} initial={mapLayout(map)} editable={editable} floorPlanUrl={plan} />
          {editable && approved.length ? (
            <div className="mt-4 border-t pt-4">
              <SelectRun action={staffCopyLayout} fields={f} name="from_map_id" label="Start from an approved map (replaces the draft)" submit="Copy layout"
                options={approved.map((m) => ({ value: String(m.id), label: `${m.name} · ${m.venue_name} (${m.seat_count} seats, #${m.id})` }))} />
            </div>
          ) : null}
        </Section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Floor plan and notes">
          <div className="space-y-4">
            <FloorPlan r={r} />
            {r.notes ? <p className="text-sm whitespace-pre-line">{r.notes}</p> : <p className="text-sm text-muted-foreground">No notes from the organizer.</p>}
          </div>
        </Section>
        <Section title="Set-up fee" description={feeSettled(r) ? "Settled." : "The organizer pays by card from their request page. The map can only be approved once the fee is paid or waived."}>
          <p className="text-sm"><FeeLine r={r} /></p>
          <div className="mt-3 flex flex-wrap gap-2">
            {r.fee_status !== "paid" ? <RunButton action={staffSetFee} fields={{ ...f, fee_status: "paid" }} size="xs">Mark paid</RunButton> : null}
            {r.fee_status !== "waived" ? <RunButton action={staffSetFee} fields={{ ...f, fee_status: "waived" }} size="xs">Waive</RunButton> : null}
            {r.fee_status !== "unpaid" && Number(r.fee_cents) > 0 ? <RunButton action={staffSetFee} fields={{ ...f, fee_status: "unpaid" }} size="xs" variant="ghost">Mark unpaid</RunButton> : null}
          </div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Conversation" description="Messages are emailed to the organizer.">
          <NotesThread notes={notes} staffView />
          {r.status !== "cancelled" ? <div className="mt-4"><MessageForm action={noteFromStaff} fields={f} label="Message to the organizer" submit="Send" /></div> : null}
        </Section>
        <Section title="Change history" description="Every save of the builder, with what changed.">
          <ChangeLog changes={changes} />
        </Section>
      </div>

      {["new", "in_progress", "awaiting_approval"].includes(r.status) ? (
        <Section title="Cancel this request">
          <div className="max-w-2xl"><MessageForm action={staffCancel} fields={f} label="Reason (sent to the organizer)" submit="Cancel request" variant="destructive" rows={2} /></div>
        </Section>
      ) : null}
    </div>
  );
}
