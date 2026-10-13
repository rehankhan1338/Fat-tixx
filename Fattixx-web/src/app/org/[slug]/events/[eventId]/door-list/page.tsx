import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg, canAccessEvent } from "@/lib/authz";
import { getEvent } from "@/lib/events/queries";
import { listEventAttendees } from "@/lib/orders/queries";
import { formatEventDate } from "@/lib/tz";

export const metadata: Metadata = { title: "Door list" };

/** Printable last-resort fallback for the door when every device is offline. */
export default async function DoorListPage({ params, searchParams }: PageProps<"/org/[slug]/events/[eventId]/door-list">) {
  const { slug, eventId } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : null);
  const type = one(sp.type), day = one(sp.day), onlyPending = one(sp.status) === "not_checked_in";
  const ctx = await requireOrg(slug);
  const event = await getEvent(ctx.org.id, Number(eventId));
  if (!event || !(await canAccessEvent(ctx, event))) notFound();
  // Optional filters (set from the attendee list): ticket type, day ("__pass" = every-day passes), not yet checked in.
  const attendees = (await listEventAttendees(event.id)).filter((a) =>
    (onlyPending ? a.ticket_status === "valid" : ["valid", "used"].includes(a.ticket_status))
    && (!type || a.ticket_type_name === type)
    && (!day || (day === "__pass" ? !a.day_label : a.day_label === day)));
  const filterNote = [type, day === "__pass" ? "passes" : day, onlyPending ? "not checked in" : null].filter(Boolean).join(" · ");
  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-black print:p-0" style={{ colorScheme: "light" }}>
      <header className="mb-4 border-b pb-3">
        <h1 className="text-xl font-bold">{event.title} — Door list</h1>
        <p className="text-sm text-neutral-600">{formatEventDate(new Date(event.starts_at), event.timezone)}{event.venue_name ? ` · ${event.venue_name}` : ""} · {attendees.length} tickets{filterNote ? ` (${filterNote})` : ""}{event.age_restriction ? ` · ${event.age_restriction}+ (check ID)` : ""} · printed {new Date().toLocaleString()}</p>
      </header>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-neutral-500"><th className="py-1 pr-2">✓</th><th className="py-1 pr-2">Attendee</th><th className="py-1 pr-2">Ticket</th><th className="py-1 pr-2">Add-ons</th><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Order</th><th className="py-1">Status</th></tr></thead>
        <tbody>
          {attendees.map((a) => (
            <tr key={a.ticket_id} className="border-b border-neutral-200">
              <td className="py-1 pr-2"><span className="inline-block size-4 border border-neutral-400" /></td>
              <td className="py-1 pr-2">{a.attendee_name ?? a.buyer_name ?? "—"}<span className="block text-xs text-neutral-500">{a.attendee_email ?? a.buyer_email}</span></td>
              <td className="py-1 pr-2">{a.ticket_type_name}{a.day_label ? ` · ${a.day_label}` : ""}{a.seat_label ? ` · ${a.seat_label}` : ""}</td>
              <td className="py-1 pr-2 text-xs">{a.addons ?? ""}</td>
              <td className="py-1 pr-2 font-mono text-xs">{a.ticket_code}</td>
              <td className="py-1 pr-2 font-mono text-xs">{a.order_code}</td>
              <td className="py-1 text-xs">{a.ticket_status === "used" ? "checked in" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
