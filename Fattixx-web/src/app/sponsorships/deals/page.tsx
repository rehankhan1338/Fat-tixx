import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listSponsorDeals } from "@/lib/sponsorships/deals";
import { cancelDeal, payDeal } from "@/lib/sponsorships/actions";
import { formatCents } from "@/lib/money";
import { EmptyState, PageHeader, StatusBadge, formatDate } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { ActionButton } from "@/components/pro/action-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Your sponsorships", robots: { index: false } };

/** A sponsor's requests and deals: pay the accepted ones, cancel open ones. */
export default async function SponsorDealsPage({ searchParams }: PageProps<"/sponsorships/deals">) {
  const session = await getSession();
  if (!session) redirect("/login?next=/sponsorships/deals");
  const sp = await searchParams;
  const deals = await listSponsorDeals(session.user.id);
  return (
    <PublicShell wide>
      <PageHeader title="Your sponsorships" description="Requests you sent to organizers. Pay once an organizer accepts." actions={<Button variant="outline" render={<Link href="/sponsorships" />}>Find opportunities</Button>} />
      {sp.paid ? <p className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">Thank you, your payment went through. It can take a moment for the status below to update.</p> : null}
      <div className="mt-6">
        {deals.length === 0 ? <EmptyState title="No sponsorships yet" description="Browse the opportunities organizers have listed." action={<Button render={<Link href="/sponsorships" />}>Sponsor an event</Button>} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Package</TableHead><TableHead>Organizer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><span className="font-medium">{d.package_title}</span><span className="block text-xs text-muted-foreground">{d.event_title ?? "Season"} · requested {formatDate(d.created_at)}</span>{d.organizer_note ? <span className="block text-xs">Organizer: {d.organizer_note}</span> : null}</TableCell>
                  <TableCell>{d.org_name}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(d.amount_cents), d.currency)}</TableCell>
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    {d.status === "accepted" ? <ActionButton action={payDeal} fields={{ id: d.id }} variant="default">Pay now</ActionButton> : null}
                    {d.status === "requested" || d.status === "accepted" ? <ConfirmButton action={cancelDeal} fields={{ id: d.id }} title="Cancel this request?" description="Nothing is charged." confirmText="Cancel request" variant="ghost">Cancel</ConfirmButton> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PublicShell>
  );
}
