import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg, canAccessEvent } from "@/lib/authz";
import { activeEventDate, getEvent, listEventDates } from "@/lib/events/queries";
import { checkinCounts, listCheckinLog } from "@/lib/orders/queries";
import { scannerSnapshot } from "@/lib/checkin/actions";
import { formatEventDate } from "@/lib/tz";
import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Scanner" };

export default async function EventScanPage({ params }: PageProps<"/org/[slug]/events/[eventId]/scan">) {
  const { slug, eventId } = await params;
  const ctx = await requireOrg(slug);
  const event = await getEvent(ctx.org.id, Number(eventId));
  if (!event || !(await canAccessEvent(ctx, event))) notFound();
  const [counts, log, snapshot, dates] = await Promise.all([checkinCounts(event.id), listCheckinLog(event.id, 20), scannerSnapshot(slug, event.id), listEventDates(event.id)]);
  const active = activeEventDate(dates);
  const when = active ? `${active.label ?? formatEventDate(new Date(active.starts_at), event.timezone, { withTime: false })} · ${formatEventDate(new Date(active.starts_at), event.timezone)} (today's day of ${dates.length})` : formatEventDate(new Date(event.starts_at), event.timezone);
  return (
    <Scanner
      orgSlug={slug}
      multiDay={dates.length > 1}
      event={{ id: event.id, title: event.title, when, venue: event.venue_name, ageRestriction: event.age_restriction }}
      initialCounts={counts}
      initialLog={log.map((l) => ({ id: l.id, result: l.result, reason: l.reason, at: new Date(l.created_at).toISOString(), staff: l.staff_name, code: l.ticket_code, name: l.attendee_name }))}
      snapshot={snapshot}
      perms={{ canOverride: ctx.perms.canOverrideCheckin, canUndo: ctx.perms.canUndoCheckin }}
    />
  );
}
