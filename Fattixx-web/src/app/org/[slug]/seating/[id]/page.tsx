import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { getSeatMap, getSeatMapRequest, listRequestNotes, mapLayout } from "@/lib/seating/queries";
import { approveSeatMap, cancelOwnRequest, noteFromOrganizer, payFee, requestMapChange, sendBackSeatMap } from "@/lib/seating/actions";
import { feeSettled, syncFeeSession } from "@/lib/seating/fee";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FeeLine, FloorPlan, MapPreview, NotesThread, RequestSteps } from "@/components/seating/request-parts";
import { MessageForm, RunButton } from "@/components/seating/request-forms";

export const metadata: Metadata = { title: "Seat map request" };

/** One seat map request, as the organizer sees it: progress, the map to check and approve, the fee and the conversation. */
export default async function SeatMapRequestPage({ params, searchParams }: PageProps<"/org/[slug]/seating/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "organizer");
  if (ctx.role === "staff") notFound();
  let r = await getSeatMapRequest(Number(id));
  if (!r || Number(r.organization_id) !== ctx.org.id) notFound();
  // Back from Stripe Checkout: record the payment now rather than waiting for the webhook.
  if (sp.fee === "paid" && typeof sp.session_id === "string" && r.fee_status === "unpaid") {
    await syncFeeSession(r.id, sp.session_id).catch((e) => console.error("[seating] fee sync failed", e));
    r = (await getSeatMapRequest(r.id))!;
  }
  const [notes, map, stripe] = await Promise.all([listRequestNotes(r.id), r.seat_map_id ? getSeatMap(Number(r.seat_map_id)) : null, isStripeConfigured()]);
  const f = { org: slug, request_id: r.id };
  const showMap = map && (r.status === "awaiting_approval" || r.status === "approved");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{r.map_name} <StatusBadge status={r.status} /></span>}
        description={<>{[r.venue_name, r.venue_city].filter(Boolean).join(", ")} · requested {formatDate(r.created_at)} · <Link href={`/org/${slug}/seating`} className="underline">All seat maps</Link></>}
      />
      <RequestSteps status={r.status} />

      {sp.fee === "paid" && r.fee_status === "paid" ? <Alert><AlertTitle>Set-up fee paid.</AlertTitle><AlertDescription>Thank you. We have started on your map.</AlertDescription></Alert> : null}
      {sp.fee === "cancelled" ? <Alert><AlertTitle>Payment not completed.</AlertTitle><AlertDescription>Your request is saved. You can pay the set-up fee from this page whenever you are ready.</AlertDescription></Alert> : null}

      {r.status === "new" ? <p className="text-sm text-muted-foreground">Our team will start on your map shortly. We will email you when it is ready to check.</p> : null}
      {r.status === "in_progress" ? <p className="text-sm text-muted-foreground">We are building your map{r.assignee_name ? ` (${r.assignee_name})` : ""}. We will email you when it is ready to check.</p> : null}

      {r.status === "awaiting_approval" ? (
        <Section title="Check and approve your map" description="Look at every section, row and seat number, and the accessible seats. Once you approve it, the map can be used on your events' Seating tab. Approved maps can't be edited; changes go through a new request.">
          {!feeSettled(r) ? <p className="mb-3 text-sm font-medium text-amber-700">Pay the set-up fee below before approving.</p> : null}
          <div className="flex flex-wrap gap-2">
            <RunButton action={approveSeatMap} fields={f} variant="default">Approve this map</RunButton>
          </div>
          <div className="mt-4 max-w-2xl">
            <MessageForm action={sendBackSeatMap} fields={f} label="Or tell us what to change" submit="Send back for changes" hint="For example: “Row C starts at seat 101”, “Boxes 1–4 are missing”." rows={3} variant="outline" />
          </div>
        </Section>
      ) : null}

      {showMap ? (
        <Section title={r.status === "approved" ? "Your map" : "Preview"} description={`${map.seat_count} seats. This is how buyers will see it; each seat gets its price and colour once you assign pricing tiers on an event.`}>
          <MapPreview layout={mapLayout(map)} label={`${map.name} seat map`} />
        </Section>
      ) : null}

      {r.status === "approved" && map ? (
        <Section title="Need a change?" description="Ask for changes to this map (no set-up fee). Events already using it keep their current seats; new events use the new version once you approve it.">
          <div className="max-w-2xl"><MessageForm action={requestMapChange} fields={{ org: slug, map_id: Number(map.id) }} label="What should change?" submit="Request a change" rows={3} /></div>
        </Section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Set-up fee">
          <p className="text-sm"><FeeLine r={r} /></p>
          {!feeSettled(r) && r.status !== "cancelled" ? (
            stripe
              ? <div className="mt-3"><RunButton action={payFee} fields={f} variant="default">Pay the set-up fee</RunButton></div>
              : <p className="mt-2 text-xs text-muted-foreground">Card payment isn’t available right now. Our team will send you an invoice.</p>
          ) : null}
        </Section>
        <Section title="What you sent">
          <div className="space-y-3">
            <FloorPlan r={r} />
            {r.notes ? <p className="text-sm whitespace-pre-line">{r.notes}</p> : null}
            {r.status === "new" ? <RunButton action={cancelOwnRequest} fields={f} variant="ghost" size="xs" success="Request cancelled">Cancel this request</RunButton> : null}
          </div>
        </Section>
      </div>

      <Section title="Messages" description="Questions or details for our team. We reply by email and here.">
        <NotesThread notes={notes} staffView={false} />
        {r.status !== "cancelled" ? <div className="mt-4 max-w-2xl"><MessageForm action={noteFromOrganizer} fields={f} label="Message" submit="Send" rows={3} /></div> : null}
      </Section>
    </div>
  );
}
