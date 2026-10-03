import type { Metadata } from "next";
import { PublicShell } from "@/components/public-shell";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <LegalPage title="Privacy Policy" sections={[
        ["What we collect", "Your name, email address and optional phone number when you buy tickets or create an account; the attendee names you enter; and the technical data needed to deliver tickets, prevent fraud and check tickets at the door (such as scan times)."],
        ["Payment details", "Card details are entered directly into our payment processor's secure fields and never reach or are stored by this website."],
        ["How we use your data", "To deliver tickets and receipts, to let organizers run their event (attendee lists, check-in), to send event updates such as postponements or cancellations, and for security and fraud prevention. Marketing email is sent only if you opted in, and every marketing email includes an unsubscribe link."],
        ["Sharing", "The organizer of an event you buy tickets for can see the attendee details for that event. We do not sell your data."],
        ["Your rights", "You can view your orders at any time through “Find my tickets”. With an account, the “Your data” section of your account page lets you download everything we hold about you and delete your account yourself. Without an account, contact the support email shown in the footer and we will handle the request after confirming the email address is yours."],
        ["Text messages", "If you ask for your tickets by text at checkout, we send the ticket link and one reminder to the phone number you entered. Nothing else is sent by text."],
        ["Cookies and tracking", "We use only the cookies needed to sign you in, remember your order, keep your place in a waiting room and credit the promoter link you arrived from. Some organizers use Meta Pixel or Google Analytics on their event pages; these load only after you accept the banner on that page, and never on checkout or payment pages. Sponsored content is counted without cookies or personal data."],
        ["Location on the homepage", "To show events near you, the homepage looks up an approximate city from your IP address using geojs.io. If you choose “Use my current location”, your browser asks for permission and the position is turned into a city name by bigdatacloud.net. The place you pick and the events you save with the heart button are stored only in your browser."],
        ["Retention", "Order and check-in records are kept for as long as needed for accounting, tax and dispute handling, then deleted or anonymized. When you delete your account, your profile is removed and those records are kept without your account."],
      ]} />
    </PublicShell>
  );
}
