import type { Metadata } from "next";
import { PublicShell } from "@/components/public-shell";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Organizer Agreement" };

/** Plan 11.6: fees, payouts, refunds, chargebacks and cancellation liability. Draft for counsel review; the money-flow terms follow the Phase 1 decisions in plan 7.2. */
export default function OrganizerAgreementPage() {
  return (
    <PublicShell>
      <LegalPage title="Organizer Agreement" sections={[
        ["Parties and scope", "This agreement is between this website and the organization (\"Organizer\") that lists events and sells tickets through it. It applies to every event the Organizer publishes. The Organizer is responsible for its events: the venue, permits, safety, accessibility, age restrictions and everything promised on the event page."],
        ["Verification", "Before selling, the Organizer provides accurate identity and business details (legal name, address, tax identification and website) and keeps them current. We may suspend sales or hold payouts while verifying an Organizer or investigating suspected fraud."],
        ["Seller of record and payments", "For the initial launch the platform is the seller of record: buyers pay the platform through Stripe, and card details are never seen or stored by the Organizer or the platform. Fees are shown to buyers all-in before purchase, as required by the FTC Rule on Unfair or Deceptive Fees."],
        ["Fees", "The platform fee and card processing fee for each event are shown in the organizer dashboard and on the settlement statement. Per event, the Organizer chooses whether buyers pay the fees on top of the ticket price or the Organizer absorbs them; absorbed fees are deducted from the payout."],
        ["Taxes", "Admissions and sales taxes are configured per event or venue (for example South Carolina's 5% admissions tax plus any local taxes), shown on receipts and reported on the settlement statement. Who files and remits tax follows the seller-of-record arrangement and must be confirmed with an accountant before launch."],
        ["Payouts", "After an event, the platform prepares a settlement statement (gross sales, platform and processing fees, refunds, chargebacks, taxes collected and net payout). Payouts are approved by platform Finance and paid by bank transfer or another agreed method. The platform may hold a reserve when an event has unusual refund or dispute risk."],
        ["Refunds", "The Organizer sets each event's refund policy, which is shown to buyers before purchase. Organizers with permission may issue full or partial refunds; every refund is logged with who issued it and why. Whether platform and processing fees are refunded is stated in the Refund Policy."],
        ["Cancellation and postponement", "If an event is cancelled, all paid orders are refunded in full and ticket holders are notified. If refunds are owed after the payout has been made, the Organizer repays the platform within 14 days, and the platform may offset the amount against future payouts. Postponed events keep tickets valid for the new date."],
        ["Chargebacks and disputes", "The platform responds to card disputes using order details and check-in records (time, staff member, device) as evidence. Lost disputes and the processor's dispute fees are passed to the Organizer and shown on the settlement statement."],
        ["Attendee data", "Attendee details are used to run the event and to send event updates. Marketing messages may only be sent to attendees who opted in, with an unsubscribe link. Ownership of attendee contact data is to be confirmed in the final agreement (plan section 9)."],
        ["Marketing tools and sponsors", "Promo codes, promoter links, tracking pixels and sponsor content are the Organizer's responsibility. Sponsor ads are reviewed by the platform before they appear. Tracking pixels load only with visitor consent and never on payment pages."],
        ["Term and termination", "Either party may end this agreement with notice; obligations for events already on sale, refunds and chargebacks survive termination."],
      ]} />
    </PublicShell>
  );
}
