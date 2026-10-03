import type { Metadata } from "next";
import { PublicShell } from "@/components/public-shell";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Refund Policy" };

export default function RefundsPage() {
  return (
    <PublicShell>
      <LegalPage title="Refund Policy" sections={[
        ["Event cancelled", "If an event is cancelled, every paid order is refunded in full to the original payment method automatically. You will receive an email confirming the refund."],
        ["Event postponed", "Tickets remain valid for the new date. If you cannot attend the new date, contact the organizer through the support email; refunds for postponed events are at the organizer's discretion."],
        ["Changed your mind", "Each event page states its own refund rule: no refunds, refunds until the event starts, or refunds up to a set number of days before. Where allowed, request the refund from your order page."],
        ["Timing", "Refunds are issued immediately and usually appear on your statement within 5 to 10 business days, depending on your bank."],
        ["Fees", "Whether service and processing fees are refunded is stated on the event page and in your confirmation email."],
      ]} />
    </PublicShell>
  );
}
