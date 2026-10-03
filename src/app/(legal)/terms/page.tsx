import type { Metadata } from "next";
import { PublicShell } from "@/components/public-shell";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <PublicShell>
      <LegalPage title="Terms of Service" sections={[
        ["Who we are", "This website sells admission tickets to live events on behalf of the organizers listed on each event page. By purchasing you agree to these terms, the event's own rules, and the Ticketing Terms below."],
        ["Tickets", "A ticket grants one admission to the event shown on it. Each QR code can be scanned once. Age restrictions shown on the event page are enforced at the door with photo ID. Tickets may be transferred only where the organizer has enabled transfers."],
        ["Prices and fees", "All prices are shown all-in before you pay: ticket price, mandatory service fee and applicable taxes. A card processing fee, shown at checkout, may apply to paid orders."],
        ["Refunds and cancellations", "Refund availability is set per event and shown on the event page. If an event is cancelled, paid orders are refunded in full. See the Refund Policy for details."],
        ["Conduct and entry", "Organizers and venues may refuse entry or remove attendees who breach venue rules or local law, without refund."],
        ["Liability", "To the extent permitted by law, our liability is limited to the amount you paid for the affected order."],
      ]} />
    </PublicShell>
  );
}
