/*
 * The social part of the checkout confirmation / order page (11.3, 11.4, 11.5, 11.8, 11.9): share that you're going,
 * follow the organizer, choose whether to show on the guest list, and — for guests — "See who else is going" by
 * creating an account with the purchase email (the order is attached when the email is confirmed).
 */

import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { queryOne, type Row } from "@/lib/db";
import { env } from "@/lib/env";
import { publicEventPath } from "@/lib/events/queries";
import { getSocialUser, hasProfile, holdsTicket } from "@/lib/social/core";
import { orgFollowInfo, whosGoing } from "@/lib/social/queries";
import { myReferralCode, publicOffer, rewardLabel } from "@/lib/social/referrals";
import FollowButton from "@/components/organizer/FollowButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EarnBox from "./EarnBox";
import GuestListToggle from "./GuestListToggle";
import ShareGoing from "./ShareGoing";

type OrderLike = {
  event_id: number; organization_id: number; event_title: string; event_slug: string; event_visibility: string; event_private_key: string | null;
  event_status: string; org_name: string; org_slug: string; buyer_email: string; currency: string; total_cents: number;
};

export default async function OrderSocial({ order }: { order: OrderLike }) {
  if (!["published", "postponed"].includes(order.event_status)) return null;
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const eventId = Number(order.event_id);
  const ev = { slug: order.event_slug, visibility: order.event_visibility, private_key: order.event_private_key };
  const eventPath = publicEventPath(ev);
  const [me, follow, holder, offer, guest] = await Promise.all([
    viewerId ? getSocialUser(viewerId) : Promise.resolve(null),
    orgFollowInfo(Number(order.organization_id), viewerId),
    viewerId ? holdsTicket(viewerId, eventId) : Promise.resolve(false),
    Number(order.total_cents) > 0 ? publicOffer(eventId) : Promise.resolve(null),
    viewerId ? queryOne<Row & { guest_list_mode: "off" | "faces" | "faces_total"; access_password: string | null }>(`SELECT guest_list_mode, access_password FROM events WHERE id = ?`, [eventId]) : Promise.resolve(null),
  ]);
  const code = viewerId ? await myReferralCode(viewerId, eventId) : null;
  const sep = eventPath.includes("?") ? "&" : "?";
  const shareUrl = code ? `${env.APP_URL}/r/${code}` : me?.username ? `${env.APP_URL}${eventPath}${sep}via=${me.username}` : `${env.APP_URL}${eventPath}`;
  const keyQs = ev.visibility === "private" && ev.private_key ? `?key=${ev.private_key}` : "";
  const going = guest && viewerId && holder ? await whosGoing({ id: eventId, guest_list_mode: guest.guest_list_mode, access_password: guest.access_password }, viewerId, 1) : null;
  const registerHref = `/register?email=${encodeURIComponent(order.buyer_email)}&next=${encodeURIComponent(`/events/${order.event_slug}/going${keyQs}`)}`;

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Share that you’re going</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <ShareGoing eventId={eventId} title={order.event_title} shareUrl={shareUrl} earning={!!code}
          storyImage={`/api/share/${order.event_slug}/story${keyQs}`} postImage={`/api/share/${order.event_slug}/post${keyQs}`} />
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <p className="min-w-0 flex-1 text-sm">Follow {order.org_name} to hear about their next event.</p>
          <FollowButton organizerId={order.org_slug} name={order.org_name} initialFollowing={follow.following} signedIn={follow.signedIn} source="order" compact />
        </div>
        {!session ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="font-medium">See who else is going</p>
            <p className="mt-1 text-muted-foreground">Create a free account with {order.buyer_email}. Your tickets are added to it automatically once you confirm your email.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link href={registerHref} className="font-medium underline underline-offset-4">Create my account</Link>
              <Link href={`/login?next=${encodeURIComponent(`/events/${order.event_slug}/going${keyQs}`)}`} className="text-muted-foreground underline underline-offset-4">I already have one</Link>
            </div>
          </div>
        ) : holder && going && going.mode !== "off" ? (
          <div className="border-t pt-4">
            <GuestListToggle eventId={eventId} initial={!!going.viewer?.listed} hasProfile={hasProfile(me)} />
            <Link href={`/events/${order.event_slug}/going${keyQs}`} className="mt-2 inline-block text-sm font-medium underline underline-offset-4">See who’s going</Link>
          </div>
        ) : null}
        {offer ? <EarnBox eventId={eventId} reward={rewardLabel(offer, order.currency)} link={code ? `${env.APP_URL}/r/${code}` : null} signedIn={!!session} holder={holder} appUrl={env.APP_URL} /> : null}
      </CardContent>
    </Card>
  );
}
