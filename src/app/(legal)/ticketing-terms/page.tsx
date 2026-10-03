import type { Metadata } from "next";
import { PublicShell } from "@/components/public-shell";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Ticketing Terms" };

/** Plan 11.6: transfer, resale, entry and age rules. Draft for counsel review. */
export default function TicketingTermsPage() {
  return (
    <PublicShell>
      <LegalPage title="Ticketing Terms" sections={[
        ["Your ticket", "Each ticket has a unique, signed QR code that admits one person (or one seat at a table) once. Keep it private: whoever presents a valid code first is admitted. Screenshots work, but the first scan wins."],
        ["Entry", "Tickets are scanned at the door. A ticket that has already been used, refunded, cancelled or transferred is refused. The organizer and venue may refuse entry or remove anyone who breaks venue rules or the law, without refund."],
        ["Age-restricted events", "Events marked 18+ or 21+ require every attendee to show valid government photo ID at the door, matching the age limit. No refund is given for refused entry because of missing or insufficient ID."],
        ["Transfers", "Where the organizer allows it, you can transfer a ticket to someone else from your order page. The new holder receives a new QR code by email and the old code stops working immediately. Transfers can be made until the event starts."],
        ["Resale", "Reselling tickets above face value, or through unauthorized resellers, may lead to the ticket being cancelled without refund where the organizer's policy or local law allows. Buy only from this website or the organizer's official links."],
        ["Changes to the event", "If an event is postponed, your ticket stays valid for the new date. If an event is cancelled, your order is refunded in full to the original payment method. Line-ups and times may change."],
        ["Refunds", "Refunds otherwise follow the policy shown on the event page and in the Refund Policy."],
        ["Waitlists and limits", "Sold-out events may offer a waitlist; joining does not guarantee a ticket. Ticket types may have per-order and per-person limits, and high-demand on-sales may use a virtual waiting room. Automated buying is not allowed."],
      ]} />
    </PublicShell>
  );
}
