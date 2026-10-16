import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requireOrg, canAccessEvent } from "@/lib/authz";
import { getEvent } from "@/lib/events/queries";
import { getOrderByCode, listOrderAddons, listOrderAnswers, listOrderItems, listOrderRefunds, listOrderTickets, ticketDayLabel } from "@/lib/orders/queries";
import { listOrderTransfers } from "@/lib/orders/transfer";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SaveImageButton } from "@/components/save-image-button";
import { OrderStaffActions, TicketEditRow } from "./order-actions";

export const metadata: Metadata = { title: "Order" };

export default async function OrgOrderPage({ params }: PageProps<"/org/[slug]/orders/[code]">) {
  const { slug, code } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const order = await getOrderByCode(code);
  if (!order || order.organization_id !== ctx.org.id) notFound();
  const event = await getEvent(ctx.org.id, order.event_id);
  if (!event || !(await canAccessEvent(ctx, event))) notFound();
  const [items, tickets, refunds, addons, answers, transfers] = await Promise.all([listOrderItems(order.id), listOrderTickets(order.id), listOrderRefunds(order.id), listOrderAddons(order.id), listOrderAnswers(order.id), listOrderTransfers(order.id)]);
  const orderLive = ["paid", "partially_refunded"].includes(order.status);
  const transferNote = (ticketId: number) => {
    const out = transfers.find((x) => Number(x.from_ticket_id) === Number(ticketId));
    if (out) return `Transferred to ${out.to_name} → ${out.to_ticket_code}`;
    const inn = transfers.find((x) => Number(x.to_ticket_id) === Number(ticketId));
    return inn ? `Received from ${inn.from_name ?? inn.from_email ?? "previous holder"} (was ${inn.from_ticket_code})` : null;
  };
  const remaining = Number(order.total_cents) - Number(order.refunded_cents);
  // Staff access to the receipt image comes from their org membership (see canAccessOrder), so no token is needed.
  const hasReceipt = ["paid", "partially_refunded", "refunded", "cancelled"].includes(order.status);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={`/org/${slug}/orders`} />}><ArrowLeftIcon /> Orders</Button>
      <PageHeader
        title={<span className="flex items-center gap-3"><span className="font-mono">{order.code}</span> <StatusBadge status={order.status} />{order.source !== "online" ? <Badge variant="outline">{order.source.replace("_", " ")}</Badge> : null}</span>}
        description={<><Link href={`/org/${slug}/events/${order.event_id}`} className="hover:underline">{order.event_title}</Link> · {formatEventDate(new Date(order.event_starts_at), order.event_timezone)} · placed {formatDate(order.created_at)}</>}
        actions={<>{hasReceipt ? <SaveImageButton href={`/orders/${order.code}/receipt`} filename={`receipt-${order.code}.jpg`} shareTitle="Receipt" variant="outline" size="default">Download receipt</SaveImageButton> : null}<OrderStaffActions orgSlug={slug} code={order.code} status={order.status} remainingCents={remaining} currency={order.currency} canRefund={ctx.perms.canRefund} hasStripe={!!order.stripe_payment_intent_id} isSuperAdmin={ctx.isSuperAdmin} /></>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Buyer" className="lg:col-span-1">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-muted-foreground">Name</dt><dd>{order.buyer_name ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{order.buyer_email}</dd></div>
            {order.buyer_phone ? <div><dt className="text-xs text-muted-foreground">Phone</dt><dd>{order.buyer_phone}</dd></div> : null}
            {answers.map((a) => <div key={a.id}><dt className="text-xs text-muted-foreground">{a.question_label}</dt><dd className="whitespace-pre-line">{a.answer}</dd></div>)}
            {!answers.length && order.checkout_answer ? <div><dt className="text-xs text-muted-foreground">Checkout answer</dt><dd>{order.checkout_answer}</dd></div> : null}
            <div><dt className="text-xs text-muted-foreground">Marketing opt-in</dt><dd>{order.marketing_opt_in ? "Yes" : "No"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Account</dt><dd>{order.user_id ? "Registered user" : "Guest checkout"}</dd></div>
            {order.stripe_payment_intent_id ? <div><dt className="text-xs text-muted-foreground">Stripe payment</dt><dd className="font-mono text-xs">{order.stripe_payment_intent_id}</dd></div> : null}
          </dl>
        </Section>

        <Section title="Payment" className="lg:col-span-2">
          <Table>
            <TableBody>
              {items.map((i) => <TableRow key={i.id}><TableCell>{i.quantity} × {i.ticket_type_name}</TableCell><TableCell className="text-right font-mono">{formatCents((Number(i.unit_price_cents) + Number(i.unit_discount_cents ?? 0)) * Number(i.quantity), order.currency)}</TableCell></TableRow>)}
              {addons.map((a) => <TableRow key={`a${a.id}`}><TableCell>{a.quantity} × {a.addon_name} <Badge variant="outline" className="ml-1 text-[10px]">add-on</Badge></TableCell><TableCell className="text-right font-mono">{formatCents(Number(a.unit_price_cents) * Number(a.quantity), order.currency)}</TableCell></TableRow>)}
              {Number(order.discount_cents) ? <TableRow><TableCell className="text-muted-foreground">Promo discount</TableCell><TableCell className="text-right font-mono">−{formatCents(Number(order.discount_cents), order.currency)}</TableCell></TableRow> : null}
              {Number(order.platform_fee_cents) ? <TableRow><TableCell className="text-muted-foreground">Service fee (buyer paid)</TableCell><TableCell className="text-right font-mono">{formatCents(Number(order.platform_fee_cents), order.currency)}</TableCell></TableRow> : null}
              {Number(order.processing_fee_cents) ? <TableRow><TableCell className="text-muted-foreground">Processing fee (buyer paid)</TableCell><TableCell className="text-right font-mono">{formatCents(Number(order.processing_fee_cents), order.currency)}</TableCell></TableRow> : null}
              {Number(order.tax_cents) ? <TableRow><TableCell className="text-muted-foreground">Tax</TableCell><TableCell className="text-right font-mono">{formatCents(Number(order.tax_cents), order.currency)}</TableCell></TableRow> : null}
              <TableRow className="font-semibold"><TableCell>Total charged</TableCell><TableCell className="text-right font-mono">{formatCents(Number(order.total_cents), order.currency)}</TableCell></TableRow>
              {Number(order.absorbed_fee_cents) ? <TableRow><TableCell className="text-muted-foreground">Fees absorbed by organizer</TableCell><TableCell className="text-right font-mono text-muted-foreground">−{formatCents(Number(order.absorbed_fee_cents), order.currency)}</TableCell></TableRow> : null}
              {Number(order.refunded_cents) ? <TableRow><TableCell className="text-destructive">Refunded</TableCell><TableCell className="text-right font-mono text-destructive">−{formatCents(Number(order.refunded_cents), order.currency)}</TableCell></TableRow> : null}
            </TableBody>
          </Table>
          {refunds.length ? (
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              {refunds.map((r) => <p key={r.id}>{formatDate(r.created_at)} · {formatCents(Number(r.amount_cents), order.currency)} · {r.kind.replace("_", " ")} · {r.status} · {r.reason} {r.initiated_by_name ? `· by ${r.initiated_by_name}` : ""}</p>)}
            </div>
          ) : null}
        </Section>
      </div>

      <Section title={`Tickets (${tickets.length})`} description="Edit attendee names or emails, or transfer a ticket to someone else. Changes are reflected on the ticket and in the scanner immediately.">
        {tickets.length === 0 ? <p className="text-sm text-muted-foreground">No tickets were issued for this order.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Type</TableHead><TableHead>Attendee</TableHead><TableHead>Status</TableHead><TableHead>Checked in</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {tickets.map((t) => <TicketEditRow key={t.id} orgSlug={slug} code={order.code} ticket={{ id: t.id, code: t.code, type: `${t.ticket_type_name}${ticketDayLabel(t, order.event_timezone) ? ` · ${ticketDayLabel(t, order.event_timezone)}` : ""}`, seat: t.seat_label, name: t.attendee_name, email: t.attendee_email, status: t.status, checkedInAt: t.checked_in_at ? formatDate(t.checked_in_at) : null, note: transferNote(t.id) }} canVoid={ctx.perms.canRefund} canTransfer={orderLive} />)}
            </TableBody>
          </Table>
        )}
      </Section>
      {transfers.length ? (
        <Section title={`Transfers (${transfers.length})`} description="Each transfer voids the old ticket and issues a new one to the recipient.">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Tickets</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
            <TableBody>
              {transfers.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(x.created_at)}</TableCell>
                  <TableCell>{x.from_name ?? "—"}<span className="block text-xs text-muted-foreground">{x.from_email}</span></TableCell>
                  <TableCell>{x.to_name}<span className="block text-xs text-muted-foreground">{x.to_email}</span></TableCell>
                  <TableCell className="font-mono text-xs">{x.from_ticket_code} → {x.to_ticket_code} <StatusBadge status={x.to_ticket_status} /></TableCell>
                  <TableCell className="text-xs">{x.initiated_by === "staff" ? `Staff${x.actor_name ? ` · ${x.actor_name}` : ""}` : "Ticket holder"}{x.note ? <span className="block text-muted-foreground">“{x.note}”</span> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}
