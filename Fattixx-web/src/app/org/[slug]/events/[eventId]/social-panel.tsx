"use client";

/* The event's Social tab (plan section 11): Who's Going and feed settings, referral rewards, sales by referrer, shares. */

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { saveEventSocial, type OrgSocialState } from "@/lib/social/org-actions";
import { inviteReferrers, removeReferrer, saveReferralOffer, type RefState } from "@/lib/social/referral-actions";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState, Section } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type SocialPanelProps = {
  orgSlug: string; eventId: number; eventSlug: string; currency: string; paid: boolean;
  settings: { mode: "off" | "faces" | "faces_total"; feed: boolean; photos: boolean; days: number };
  offers: { kind: "public" | "invite"; type: "fixed" | "percent"; basis: "ticket" | "order"; value: string; active: boolean }[];
  referrers: { id: number; who: string; status: string; kind: string; code: string | null; clicks: number; orders: number; tickets: number; revenue: string; rewards: string; flagged: number }[];
  rewardsTotal: string;
  shares: { channel: string; n: number }[]; shareOrders: number; shareRevenue: string;
  guestList: { listed: number; total: number };
};

function SettingsForm({ p }: { p: SocialPanelProps }) {
  const [state, action] = useActionState<OrgSocialState, FormData>(saveEventSocial, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={p.orgSlug} /><input type="hidden" name="event_id" value={p.eventId} />
      <SelectField label="Who’s Going on the event page" id="sp-mode" name="guest_list_mode" defaultValue={p.settings.mode}
        options={[{ value: "faces", label: "Faces only: photos and names, no total" }, { value: "faces_total", label: "Faces and total: photos, names and how many are going" }, { value: "off", label: "Off" }]}
        hint={`${p.guestList.listed} ticket holder(s) chose to show on the list. Only signed-in ticket holders who allow it appear.`} />
      <CheckField id="sp-feed" name="feed_enabled" defaultChecked={p.settings.feed} label="Event feed: a discussion area for ticket holders below the description" />
      <CheckField id="sp-photos" name="feed_attendee_photos" defaultChecked={p.settings.photos} label="Let attendees add photos to their posts (your team can always add photos)" />
      <TextField label="Days the feed stays open after the event" id="sp-days" name="feed_open_days" type="number" min={0} max={90} defaultValue={p.settings.days} hint="Then it turns read-only." className="max-w-xs" />
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}

function OfferForm({ p, kind }: { p: SocialPanelProps; kind: "public" | "invite" }) {
  const o = p.offers.find((x) => x.kind === kind);
  const [state, action] = useActionState<RefState, FormData>(saveReferralOffer, undefined);
  return (
    <form action={action} className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2"><h4 className="font-medium">{kind === "public" ? "Public offer" : "Invite-only offer"}</h4>{o?.active ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}</div>
      <p className="text-xs text-muted-foreground">{kind === "public" ? "Any ticket buyer can join from the event page and get a personal link." : "Only promoters, influencers or partners you invite, usually with a higher reward."}</p>
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={p.orgSlug} /><input type="hidden" name="event_id" value={p.eventId} /><input type="hidden" name="kind" value={kind} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Reward" id={`of-type-${kind}`} name="reward_type" defaultValue={o?.type ?? "fixed"} options={[{ value: "fixed", label: `Fixed amount (${p.currency})` }, { value: "percent", label: "Percentage" }]} />
        <SelectField label="Per" id={`of-basis-${kind}`} name="reward_basis" defaultValue={o?.basis ?? "ticket"} options={[{ value: "ticket", label: "Ticket" }, { value: "order", label: "Order" }]} hint="Percentages are of each sale." />
        <TextField label="Amount" id={`of-value-${kind}`} name="reward_value" defaultValue={o?.value ?? ""} placeholder="5.00 or 10" required inputMode="decimal" />
      </div>
      <CheckField id={`of-active-${kind}`} name="active" defaultChecked={o ? o.active : true} label="Offer is on" />
      <SubmitButton size="sm" pendingText="Saving…">Save offer</SubmitButton>
    </form>
  );
}

function InviteForm({ p }: { p: SocialPanelProps }) {
  const [state, action] = useActionState<RefState, FormData>(inviteReferrers, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={p.orgSlug} /><input type="hidden" name="event_id" value={p.eventId} />
      <TextAreaField label="Invite by email or phone" id="ref-contacts" name="contacts" rows={3} placeholder={"promoter@example.com\n(843) 555-0123"} hint="One per line, up to 100. They get a link to accept the Referral Rewards Terms and get their personal link." />
      <SubmitButton size="sm" pendingText="Sending…">Send invitations</SubmitButton>
    </form>
  );
}

export function SocialPanel(p: SocialPanelProps) {
  const [pending, start] = useTransition();
  const hasInvite = p.offers.some((o) => o.kind === "invite");
  return (
    <div className="space-y-6">
      <Section title="Who’s Going and event feed" description="Attendees choose whether they appear. Social pages never show ticket types, prices, order numbers or QR codes.">
        <SettingsForm p={p} />
      </Section>

      <Section title="Referral rewards" description="Pay attendees and promoters for tickets sold through their personal link. Rewards come out of your proceeds after the event; buyers pay the same price. Refunded or disputed sales reverse the reward.">
        {!p.paid ? <p className="text-sm text-muted-foreground">Referral rewards are for paid events. Add a paid ticket type first.</p> : (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <OfferForm p={p} kind="public" />
              <OfferForm p={p} kind="invite" />
            </div>
            {hasInvite ? <InviteForm p={p} /> : null}
          </div>
        )}
      </Section>

      <Section title="Sales by referrer" description={`Rewards owed for this event so far: ${p.rewardsTotal}. They appear as a line on the settlement statement.`}>
        {p.referrers.length === 0 ? <EmptyState title="No referrers yet" description="Turn on an offer, then share the event or invite promoters." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Referrer</TableHead><TableHead>Link</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Rewards</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {p.referrers.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><div className="font-medium">{r.who}</div><div className="text-xs text-muted-foreground">{r.kind === "invite" ? "Invited" : "Public offer"} · {r.status}{r.flagged ? " · flagged for review" : ""}</div></TableCell>
                  <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.clicks}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tickets}</TableCell>
                  <TableCell className="text-right font-mono">{r.revenue}</TableCell>
                  <TableCell className="text-right font-mono">{r.rewards}</TableCell>
                  <TableCell className="text-right">{r.status !== "removed" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Remove this referrer? Their link stops earning; sales already made keep their rewards.")) start(async () => { const x = await removeReferrer(p.orgSlug, r.id); if (x?.error) toast.error(x.error); }); }}>Remove</Button> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Shares" description="“Share that you’re going” after checkout, and the sales that came through those links.">
        <div className="flex flex-wrap gap-6 text-sm">
          <div><div className="text-2xl font-semibold tabular-nums">{p.shares.reduce((n, s) => n + s.n, 0)}</div><div className="text-muted-foreground">shares</div></div>
          <div><div className="text-2xl font-semibold tabular-nums">{p.shareOrders}</div><div className="text-muted-foreground">orders from shares</div></div>
          <div><div className="text-2xl font-semibold tabular-nums">{p.shareRevenue}</div><div className="text-muted-foreground">sales from shares</div></div>
        </div>
        {p.shares.length ? <p className="mt-3 text-xs text-muted-foreground">{p.shares.map((s) => `${s.channel}: ${s.n}`).join(" · ")}</p> : null}
        <p className="mt-3 text-xs text-muted-foreground">Feed reports and audience tools are under <a href={`/org/${p.orgSlug}/audience`} className="underline">Audience</a>.</p>
      </Section>
    </div>
  );
}
