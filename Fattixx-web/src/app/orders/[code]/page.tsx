import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2Icon, MailIcon, SendIcon } from "lucide-react";
import { getOrderByCode, listOrderAddons, listOrderItems, listOrderTickets, ticketDayLabel } from "@/lib/orders/queries";
import { canAccessOrder } from "@/lib/orders/access";
import { attendeeMayRequestRefund } from "@/lib/orders/checkout";
import { ticketQrDataUrl, ticketUrl } from "@/lib/tickets";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { PublicShell } from "@/components/public-shell";
import { AdSlot } from "@/components/ad-slot";
import { StatusBadge } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { heldByRecipient, holderMayTransfer } from "@/lib/orders/transfer";
import { AttendeeNameForm, BuyerTransferButton, RefundRequestButton } from "./order-client";
import { SaveImageButton } from "@/components/save-image-button";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[code]">) {
  const { code } = await params;
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : null;
  const order = await getOrderByCode(code);
  if (!order || !(await canAccessOrder(order, token))) notFound();
  if (order.status === "pending") redirect(`/checkout/${order.code}`);
  const [items, allTickets, addons] = await Promise.all([listOrderItems(order.id), listOrderTickets(order.id), listOrderAddons(order.id)]);
  // A transferred-out ticket is replaced by the recipient's new one; only that new one is shown (without its QR).
  const tickets = allTickets.filter((t) => t.status !== "transferred");
  const given = (t: (typeof tickets)[number]) => heldByRecipient(t, order.buyer_email);
  const qrs = await Promise.all(tickets.map((t) => (["valid", "used"].includes(t.status) && !given(t) ? ticketQrDataUrl(t.code, t.secret) : Promise.resolve(null))));
  const mayRefund = attendeeMayRequestRefund(order);
  const mayTransfer = !holderMayTransfer(order);
  const hasReceipt = ["paid", "partially_refunded", "refunded", "cancelled"].includes(order.status);
  const receiptHref = `/orders/${order.code}/receipt${token ? `?t=${encodeURIComponent(token)}` : ""}`;

  return (
    <PublicShell wide>
      <div className="space-y-6">
        {order.status === "paid" ? (
          <Alert className="border-emerald-500/40"><CheckCircle2Icon className="text-emerald-400" /><AlertTitle>You’re going! Your tickets are below and on their way to {order.buyer_email}.</AlertTitle><AlertDescription>Show the QR code at the door, on your phone or printed.{order.age_restriction ? ` This event is ${order.age_restriction}+; bring a valid photo ID.` : ""}</AlertDescription></Alert>
        ) : <Alert><AlertTitle>Order {order.code}</AlertTitle><AlertDescription>Status: <StatusBadge status={order.status} /></AlertDescription></Alert>}

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <h1 className="text-2xl font-bold tracking-tight">{order.event_title}</h1>
            <p className="text-muted-foreground">{formatEventDate(new Date(order.event_starts_at), order.event_timezone)}{order.venue_name ? ` · ${order.venue_name}` : ""}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {tickets.map((t, i) => (
                <Card key={t.id} className={["valid", "used"].includes(t.status) ? "" : "opacity-60"}>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-base">{t.ticket_type_name} <StatusBadge status={t.status} /></CardTitle>{ticketDayLabel(t, order.event_timezone) ? <p className="text-xs text-muted-foreground">Valid {ticketDayLabel(t, order.event_timezone)}</p> : null}{t.seat_label ? <p className="text-xs text-muted-foreground">{t.seat_label}</p> : null}</CardHeader>
                  <CardContent className="space-y-3">
                    {given(t) ? (
                      <p className="flex items-center justify-center gap-2 py-6 text-center text-sm text-muted-foreground"><SendIcon className="size-4" /> Transferred to {t.attendee_name ?? t.attendee_email}</p>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {qrs[i] ? <img src={qrs[i]!} alt={`QR code for ticket ${t.code}`} className="mx-auto w-44 rounded-lg bg-white p-2" /> : <p className="text-center text-sm text-muted-foreground">This ticket is no longer valid.</p>}
                        <p className="text-center font-mono text-xs text-muted-foreground">{t.code}</p>
                        {["valid", "used"].includes(t.status) ? (
                          <>
                            <AttendeeNameForm code={order.code} token={token} ticketId={t.id} currentName={t.attendee_name} locked={t.status !== "valid"} />
                            <Button variant="outline" size="sm" className="w-full" render={<Link href={ticketUrl(t.code, t.secret)} target="_blank" />}>Open full-screen ticket</Button>
                            {mayTransfer && t.status === "valid" ? <BuyerTransferButton code={order.code} token={token} ticketId={t.id} ticketCode={t.code} /> : null}
                          </>
                        ) : null}
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Receipt · <span className="font-mono">{order.code}</span></CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {items.map((i) => <div key={i.id} className="flex justify-between"><span>{i.quantity} × {i.ticket_type_name}</span><span className="font-mono">{formatCents((Number(i.unit_price_cents) + Number(i.unit_discount_cents ?? 0)) * Number(i.quantity), order.currency)}</span></div>)}
                {addons.map((a) => <div key={`a${a.id}`} className="flex justify-between"><span>{a.quantity} × {a.addon_name} <span className="text-xs text-muted-foreground">add-on</span></span><span className="font-mono">{formatCents(Number(a.unit_price_cents) * Number(a.quantity), order.currency)}</span></div>)}
                {Number(order.discount_cents) ? <div className="flex justify-between text-emerald-700 dark:text-emerald-300"><span>Promo discount</span><span className="font-mono">−{formatCents(Number(order.discount_cents), order.currency)}</span></div> : null}
                {Number(order.platform_fee_cents) ? <div className="flex justify-between text-muted-foreground"><span>Service fee</span><span className="font-mono">{formatCents(Number(order.platform_fee_cents), order.currency)}</span></div> : null}
                {Number(order.processing_fee_cents) ? <div className="flex justify-between text-muted-foreground"><span>Card processing</span><span className="font-mono">{formatCents(Number(order.processing_fee_cents), order.currency)}</span></div> : null}
                {Number(order.tax_cents) ? <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="font-mono">{formatCents(Number(order.tax_cents), order.currency)}</span></div> : null}
                <Separator />
                <div className="flex justify-between font-semibold"><span>Total paid</span><span className="font-mono">{formatCents(Number(order.total_cents), order.currency)}</span></div>
                {Number(order.refunded_cents) ? <div className="flex justify-between text-destructive"><span>Refunded</span><span className="font-mono">−{formatCents(Number(order.refunded_cents), order.currency)}</span></div> : null}
                {addons.length ? <p className="pt-2 text-xs text-muted-foreground">Add-ons have no QR code: show your order number <span className="font-mono">{order.code}</span> at the venue to collect them.</p> : null}
                <p className="pt-2 text-xs text-muted-foreground">Sold by {order.org_name} via Fattixx.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Your order</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MailIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 break-words">A copy was emailed to <span className="font-medium text-foreground">{order.buyer_email}</span>.</span>
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {hasReceipt ? <SaveImageButton href={receiptHref} filename={`receipt-${order.code}.jpg`} shareTitle="Receipt" variant="outline" size="sm" className={mayRefund ? "w-full sm:col-span-2" : "w-full"}>Download receipt</SaveImageButton> : null}
                  {mayRefund ? <RefundRequestButton code={order.code} token={token} amountLabel={formatCents(Number(order.total_cents), order.currency)} className="w-full" /> : null}
                  <Button variant="outline" size="sm" className={mayRefund || hasReceipt ? "w-full" : "w-full sm:col-span-2"} render={<Link href="/tickets/find" />}>Find my other tickets</Button>
                </div>
                {!mayRefund ? <p className="text-xs text-muted-foreground">Refunds: {order.refund_policy === "no_refunds" ? "not available except if the event is cancelled." : "no longer available for this order."}</p> : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {["paid", "partially_refunded"].includes(order.status) ? <AdSlot placement="order_confirmation" eventId={Number(order.event_id)} className="mt-8" /> : null}
    </PublicShell>
  );
}
