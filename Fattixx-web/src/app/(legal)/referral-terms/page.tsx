import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = { title: "Referral Rewards Terms", description: "The rules for earning referral rewards on Fattixx." };

/*
 * Referral Rewards Terms (Social & Community 11.9). Plain, short and specific to how the program works in the code
 * (src/lib/social/referrals.ts). Have counsel review before launch, like the Terms of Service.
 */
export default function ReferralTermsPage() {
  return (
    <PublicShell>
      <article className="max-w-3xl space-y-4 leading-relaxed [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        <h1>Referral Rewards Terms</h1>
        <p className="text-sm text-muted-foreground">These terms apply when you join an event’s referral rewards on Fattixx, from the event page or an organizer’s invitation. They add to the <Link href="/terms">Terms of Service</Link>.</p>

        <h2>1. How you earn</h2>
        <ul>
          <li>You get a personal link for one event. When someone buys tickets through it, you earn the reward the organizer set (a fixed amount or a percentage, per ticket or per order). The reward is shown before you join.</li>
          <li>Rewards come out of the organizer’s proceeds. Buyers pay the same price with or without your link.</li>
          <li>Only completed, paid sales count. If a sale is refunded, the reward shrinks or is removed; if it is disputed, the reward is removed.</li>
          <li>You don’t earn anything for tickets you buy through your own link.</li>
          <li>Fattixx may keep a share of each reward. Your dashboard shows what you will receive.</li>
        </ul>

        <h2>2. When you are paid</h2>
        <ul>
          <li>Nothing is paid before the event ends. Rewards are paid on the same schedule as organizer payouts after the event.</li>
          <li>You must set up payout details in your account (Referral rewards). Earnings wait until that is done.</li>
          <li>If the event is cancelled, no rewards are paid for it.</li>
          <li>You are responsible for any taxes on what you earn. Fattixx may ask for tax information before paying you.</li>
        </ul>

        <h2>3. You must say you earn a reward</h2>
        <p>Whenever you promote an event with your link, you must clearly say that you earn a reward from ticket sales, as the US Federal Trade Commission’s endorsement rules require. Put it where people will see it before they click, for example “#ad” or “I earn a reward if you buy through my link”. Don’t make claims about the event you know are untrue.</p>

        <h2>4. What’s not allowed</h2>
        <ul>
          <li>Buying through your own link, or having others buy and pass the tickets back to you, to earn rewards.</li>
          <li>Spam, fake accounts, misleading ads, or bidding on the organizer’s or Fattixx’s name in search ads.</li>
          <li>Many orders from the same card, device or network that look arranged. These are flagged and held while Fattixx support reviews them.</li>
        </ul>
        <p>If we find a breach, we can withhold or reverse rewards, remove your link and close your access to referral rewards.</p>

        <h2>5. Changes and ending</h2>
        <p>Organizers can change or end a referral offer at any time; sales already made keep their rewards. We may change these terms; the version on this page applies to rewards earned after the change.</p>

        <p className="text-sm text-muted-foreground">Questions? Contact Fattixx support.</p>
      </article>
    </PublicShell>
  );
}
