import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { logout } from "@/lib/auth/actions";
import { queryOne, type Row } from "@/lib/db";
import { listOrdersForEmail } from "@/lib/orders/queries";
import { listMemberships } from "@/lib/authz";
import { formatCents } from "@/lib/money";
import { formatDate, StatusBadge, EmptyState, PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { AdSlot } from "@/components/ad-slot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrivacyPanel, VerifyEmailBanner } from "./account-client";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const session = await requireSession();
  const sp = await searchParams;
  const verified = session.user.emailVerified;
  // Until the email is confirmed, only orders already tied to this account are shown.
  const [orders, memberships, pw] = await Promise.all([
    listOrdersForEmail(verified ? session.user.email : null, session.user.id), listMemberships(session.user.id),
    queryOne<Row & { has: number }>(`SELECT password_hash IS NOT NULL AS has FROM users WHERE id = ?`, [session.user.id]),
  ]);
  const upcoming = orders.filter((o) => ["paid", "partially_refunded"].includes(o.status));
  return (
    <PublicShell>
      <PageHeader title={`Hi, ${session.user.name}`} description={session.user.email} actions={<>{memberships.length ? <Button variant="outline" render={<Link href="/dashboard" />}>Organizer tools</Button> : null}<form action={logout}><Button variant="ghost" type="submit">Sign out</Button></form></>} />
      {!verified ? <VerifyEmailBanner email={session.user.email} justSent={sp.verify === "sent"} /> : null}
      <h2 className="mt-8 mb-3 text-lg font-semibold">Your tickets & orders</h2>
      {orders.length === 0 ? <EmptyState title="No orders yet" description={verified ? "Tickets you buy with this email appear here." : "Confirm your email to see tickets bought earlier with it."} action={<Button render={<Link href="/" />}>Browse events</Button>} /> : (
        <div className="space-y-3">
          {upcoming.concat(orders.filter((o) => !upcoming.includes(o))).map((o) => (
            <Card key={o.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div><p className="font-semibold">{o.event_title}</p><p className="text-xs text-muted-foreground">Order <span className="font-mono">{o.code}</span> · {o.ticket_count} ticket(s) · {formatCents(Number(o.total_cents), o.currency)} · {formatDate(o.paid_at ?? o.created_at)} · <StatusBadge status={o.status} /></p></div>
              <Button variant="outline" render={<Link href={`/orders/${o.code}`} />}>View tickets</Button>
            </CardContent></Card>
          ))}
        </div>
      )}
      <AdSlot placement="ticket_dashboard" className="mt-8" />
      <div className="mt-10">
        <Section title="Your data" description="Download a copy of everything we hold about you, or delete your account.">
          <PrivacyPanel hasPassword={!!Number(pw?.has)} />
        </Section>
      </div>
    </PublicShell>
  );
}
