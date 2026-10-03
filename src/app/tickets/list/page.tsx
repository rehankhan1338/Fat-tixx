import type { Metadata } from "next";
import Link from "next/link";
import { consumeOneTimeToken, peekOneTimeToken } from "@/lib/tokens";
import { listOrdersForEmail } from "@/lib/orders/queries";
import { listTicketsReceivedBy } from "@/lib/orders/transfer";
import { ticketUrl } from "@/lib/tickets";
import { formatEventDate } from "@/lib/tz";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { execute } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { PublicShell } from "@/components/public-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, EmptyState } from "@/components/shared";

export const metadata: Metadata = { title: "My tickets", robots: { index: false } };

/**
 * Magic-link landing: the token proves the email. To let the visitor open each order, we mint
 * fresh per-order access tokens and pass them in the links (the buyer's cookie is set on open).
 */
export default async function TicketsListPage({ searchParams }: PageProps<"/tickets/list">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const rec = await peekOneTimeToken(token, "find_tickets");
  if (!rec) {
    return <PublicShell><Alert variant="destructive"><AlertTitle>This link is invalid or has expired.</AlertTitle><AlertDescription><Link href="/tickets/find" className="underline">Request a new one</Link>.</AlertDescription></Alert></PublicShell>;
  }
  await consumeOneTimeToken(rec.id);
  const [orders, received] = await Promise.all([listOrdersForEmail(rec.email, null), listTicketsReceivedBy(rec.email)]);
  // Rotate access tokens for these orders so the emailed links are the only live ones.
  const links = new Map<number, string>();
  for (const o of orders) {
    const t = randomToken(24);
    await execute(`UPDATE orders SET access_token_hash = ? WHERE id = ?`, [sha256(t), o.id]);
    links.set(o.id, t);
  }

  return (
    <PublicShell>
      <h1 className="text-2xl font-bold tracking-tight">Tickets for {rec.email}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Open an order to see its QR codes. These links stay valid on this device.</p>
      <div className="mt-6 space-y-3">
        {orders.length === 0 && received.length === 0 ? <EmptyState title="No orders found for this email" /> : orders.map((o) => (
          <Card key={o.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div><p className="font-semibold">{o.event_title}</p><p className="text-xs text-muted-foreground">Order <span className="font-mono">{o.code}</span> · {o.ticket_count} ticket(s) · {formatCents(Number(o.total_cents), o.currency)} · <StatusBadge status={o.status} /></p></div>
            <Button render={<Link href={`/orders/${o.code}?t=${links.get(o.id)}`} />}>Open tickets</Button>
          </CardContent></Card>
        ))}
      </div>
      {received.length ? (
        <>
          <h2 className="mt-8 text-lg font-semibold tracking-tight">Tickets transferred to you</h2>
          <div className="mt-3 space-y-3">
            {received.map((t) => (
              <Card key={t.code}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div><p className="font-semibold">{t.event_title}</p><p className="text-xs text-muted-foreground">{formatEventDate(new Date(t.event_starts_at), t.event_timezone)} · {t.ticket_type_name} · <span className="font-mono">{t.code}</span> · <StatusBadge status={t.status} /></p></div>
                <Button render={<Link href={ticketUrl(t.code, t.secret)} />}>Open ticket</Button>
              </CardContent></Card>
            ))}
          </div>
        </>
      ) : null}
    </PublicShell>
  );
}
