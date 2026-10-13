import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOrderByCode, listOrderAddons, listOrderItems } from "@/lib/orders/queries";
import { canAccessOrder } from "@/lib/orders/access";
import { expireStaleHolds, holdExpired } from "@/lib/orders/checkout";
import { getActiveStripe } from "@/lib/payments/stripe";
import { publicEventPath } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { PublicShell } from "@/components/public-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckoutPayment, FreeOrderButton, HoldCountdown } from "./checkout-client";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ params }: PageProps<"/checkout/[code]">) {
  const { code } = await params;
  await expireStaleHolds();
  const order = await getOrderByCode(code);
  if (!order || !(await canAccessOrder(order))) notFound();
  if (order.status === "paid" || order.status === "refunded" || order.status === "partially_refunded") redirect(`/orders/${order.code}`);
  const [items, addons, stripeActive] = await Promise.all([listOrderItems(order.id), listOrderAddons(order.id), getActiveStripe()]);
  const expired = holdExpired(order);

  return (
    <PublicShell wide>
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
          <p className="mt-1 text-sm text-muted-foreground">Order <span className="font-mono">{order.code}</span> · tickets go to <strong>{order.buyer_email}</strong></p>
          <div className="mt-6">
            {expired ? (
              <Alert variant="destructive"><AlertTitle>Your reservation expired.</AlertTitle><AlertDescription>The tickets were released. <Link href={publicEventPath({ slug: order.event_slug, visibility: order.event_visibility, private_key: order.event_private_key })} className="underline">Start again</Link>.</AlertDescription></Alert>
            ) : order.total_cents === 0 ? (
              <Card><CardHeader><CardTitle>Free order</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">No payment needed. Confirm to receive your tickets by email.</p><FreeOrderButton code={order.code} /></CardContent></Card>
            ) : !stripeActive ? (
              <Alert variant="destructive"><AlertTitle>Card payments are not available yet.</AlertTitle><AlertDescription>The organizer has not finished setting up payments. Please try again later.</AlertDescription></Alert>
            ) : (
              <Card>
                <CardHeader><CardTitle className="flex items-center justify-between">Payment <HoldCountdown expiresAt={new Date(order.hold_expires_at!).toISOString()} /></CardTitle></CardHeader>
                <CardContent><CheckoutPayment code={order.code} publishableKey={stripeActive.publishableKey} amountLabel={formatCents(order.total_cents, order.currency)} />{stripeActive.mode === "test" ? <p className="mt-3 text-xs text-amber-700">Test mode: use card 4242 4242 4242 4242, any future date, any CVC.</p> : null}</CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader><CardTitle className="text-base">{order.event_title}</CardTitle><p className="text-sm text-muted-foreground">{formatEventDate(new Date(order.event_starts_at), order.event_timezone)}{order.venue_name ? ` · ${order.venue_name}` : ""}</p></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {items.map((i) => <div key={i.id} className="flex justify-between"><span>{i.quantity} × {i.ticket_type_name}</span><span className="font-mono">{formatCents((Number(i.unit_price_cents) + Number(i.unit_discount_cents ?? 0)) * Number(i.quantity), order.currency)}</span></div>)}
              {addons.map((a) => <div key={`a${a.id}`} className="flex justify-between"><span>{a.quantity} × {a.addon_name} <span className="text-xs text-muted-foreground">add-on</span></span><span className="font-mono">{formatCents(Number(a.unit_price_cents) * Number(a.quantity), order.currency)}</span></div>)}
              {Number(order.discount_cents) ? <div className="flex justify-between text-emerald-700 dark:text-emerald-300"><span>Promo discount</span><span className="font-mono">−{formatCents(Number(order.discount_cents), order.currency)}</span></div> : null}
              {Number(order.platform_fee_cents) ? <div className="flex justify-between text-muted-foreground"><span>Service fee</span><span className="font-mono">{formatCents(Number(order.platform_fee_cents), order.currency)}</span></div> : null}
              {Number(order.processing_fee_cents) ? <div className="flex justify-between text-muted-foreground"><span>Card processing</span><span className="font-mono">{formatCents(Number(order.processing_fee_cents), order.currency)}</span></div> : null}
              {Number(order.tax_cents) ? <div className="flex justify-between text-muted-foreground"><span>Tax</span><span className="font-mono">{formatCents(Number(order.tax_cents), order.currency)}</span></div> : null}
              <Separator />
              <div className="flex justify-between text-base font-semibold"><span>Total</span><span className="font-mono">{formatCents(Number(order.total_cents), order.currency)}</span></div>
              {order.age_restriction ? <p className="pt-2 text-xs text-amber-700 dark:text-amber-300">{order.age_restriction}+ event. Photo ID required at the door.</p> : null}
              <Button variant="ghost" size="sm" className="mt-2 w-full" render={<Link href={publicEventPath({ slug: order.event_slug, visibility: order.event_visibility, private_key: order.event_private_key })} />}>Change tickets</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
