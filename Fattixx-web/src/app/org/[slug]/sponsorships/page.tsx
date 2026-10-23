import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/authz";
import { listOrgEvents } from "@/lib/events/queries";
import { centsToDollarsInput, formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { listOrgDeals, listOrgPackages, organizerDealCents } from "@/lib/sponsorships/deals";
import { cancelDeal } from "@/lib/sponsorships/actions";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecideForm, EMPTY_PACKAGE, PackageForm } from "./sponsorship-forms";

export const metadata: Metadata = { title: "Sponsorships" };

/** Organizer: sponsorship packages on the marketplace and the requests sponsors send (lib/sponsorships/deals.ts). */
export default async function OrgSponsorshipsPage({ params }: PageProps<"/org/[slug]/sponsorships">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const [packages, deals, events, s] = await Promise.all([listOrgPackages(ctx.org.id), listOrgDeals(ctx.org.id), listOrgEvents(ctx.org.id), getSettings()]);
  const upcoming = events.filter((e) => new Date(e.starts_at) > new Date() && e.status !== "cancelled").map((e) => ({ id: Number(e.id), title: e.title }));
  const open = deals.filter((d) => d.status === "requested");
  const paid = deals.filter((d) => d.status === "paid");
  const feePct = (Number(s.sponsorship_fee_bps) / 100).toFixed(1);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Sponsorships" description={<>List what you offer sponsors on the <Link href="/sponsorships" className="underline" target="_blank">sponsorship marketplace</Link>. Brands request a package, you accept, they pay through Fattixx. Fattixx keeps {feePct}%; the rest is paid out to you{ctx.isOrgAdmin ? <> (see <Link href={`/org/${slug}/payouts`} className="underline">Payouts</Link>)</> : null}.</>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Requests waiting" value={open.length} />
        <Stat label="Paid sponsorships" value={paid.length} hint={formatCents(paid.reduce((n, d) => n + Number(d.amount_cents), 0))} />
        <Stat label="Your share" value={formatCents(paid.reduce((n, d) => n + organizerDealCents(d), 0))} hint={`after the ${feePct}% fee`} />
      </div>

      <Section title="Requests" description={ctx.isOrgAdmin ? "Accepting asks the sponsor to pay; nothing is charged before that." : "An Organization Admin answers requests."}>
        {deals.length === 0 ? <EmptyState title="No requests yet" description="Requests for your listed packages appear here." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Sponsor</TableHead><TableHead>Package</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-72">
                    <span className="font-medium">{d.sponsor_name}</span>
                    <span className="block text-xs text-muted-foreground">{d.contact_name} · <a href={`mailto:${d.contact_email}`} className="underline">{d.contact_email}</a>{d.website ? <> · <a href={d.website} target="_blank" rel="noreferrer" className="underline">website</a></> : null}</span>
                    {d.message ? <span className="mt-1 block text-xs whitespace-pre-line">“{d.message}”</span> : null}
                    <span className="block text-xs text-muted-foreground">{formatDate(d.created_at)}</span>
                  </TableCell>
                  <TableCell className="text-xs">{d.package_title}{d.event_title ? <span className="block text-muted-foreground">{d.event_title}</span> : null}{d.campaign_id && d.event_id ? <Link href={`/org/${slug}/events/${d.event_id}?tab=marketing`} className="block underline">Add the sponsor ad image</Link> : null}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(d.amount_cents), d.currency)}{d.status === "paid" ? <span className="block text-xs text-muted-foreground">you get {formatCents(organizerDealCents(d), d.currency)}</span> : null}</TableCell>
                  <TableCell className="min-w-72">
                    {d.status === "requested" && ctx.isOrgAdmin ? <DecideForm org={slug} id={Number(d.id)} /> : null}
                    {d.status === "accepted" && ctx.isOrgAdmin ? <ConfirmButton action={cancelDeal} fields={{ id: d.id }} title="Cancel this accepted sponsorship?" description="The sponsor has not paid yet and will be told it is cancelled." confirmText="Cancel it" variant="ghost">Cancel</ConfirmButton> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Packages">
        <div className="space-y-4">
          {packages.map((p) => (
            <details key={p.id} className="rounded-xl border p-4">
              <summary className="cursor-pointer">
                <span className="font-medium">{p.title}</span> <StatusBadge status={p.status} />
                <span className="ml-2 text-sm text-muted-foreground">{formatCents(Number(p.price_cents), p.currency)} · {p.sold}/{p.quantity} sold · {p.event_title ?? "season"}</span>
                {p.status === "listed" ? <Link href={`/sponsorships/${p.id}`} target="_blank" className="ml-2 text-sm underline">view</Link> : null}
              </summary>
              <div className="pt-4">
                <PackageForm org={slug} events={p.event_id && !upcoming.some((e) => e.id === Number(p.event_id)) ? [...upcoming, { id: Number(p.event_id), title: p.event_title ?? "Past event" }] : upcoming}
                  values={{ id: Number(p.id), title: p.title, description: p.description ?? "", perks: p.perks ?? "", price: centsToDollarsInput(Number(p.price_cents)), quantity: Number(p.quantity), event_id: p.event_id ? String(p.event_id) : "", includes_ad: !!Number(p.includes_ad), status: p.status }} />
              </div>
            </details>
          ))}
          <details className="rounded-xl border border-dashed p-4" open={!packages.length}>
            <summary className="cursor-pointer font-medium">Add a package</summary>
            <div className="pt-4"><PackageForm org={slug} events={upcoming} values={EMPTY_PACKAGE} /></div>
          </details>
        </div>
      </Section>
    </div>
  );
}
