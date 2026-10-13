import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { listOrgOrders } from "@/lib/orders/queries";
import { PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/components/orders-table";

export const metadata: Metadata = { title: "Orders" };

export default async function OrgOrdersPage({ params, searchParams }: PageProps<"/org/[slug]/orders">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "organizer");
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const eventId = typeof sp.event === "string" && /^\d+$/.test(sp.event) ? Number(sp.event) : undefined;
  const orders = await listOrgOrders(ctx.org.id, q, eventId);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Orders" description="Search by order number, buyer, attendee name or ticket code. Open an order to resend tickets, edit names or refund." />
      <Card><CardContent className="pt-6">
        <form className="mb-4 flex gap-2" action={`/org/${slug}/orders`}>
          {eventId ? <input type="hidden" name="event" value={eventId} /> : null}
          <Input name="q" defaultValue={q} placeholder="FTX-XXXXXX, email, name or ticket code" className="max-w-md" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <OrdersTable orders={orders} hrefFor={(o) => `/org/${slug}/orders/${o.code}`} />
      </CardContent></Card>
    </div>
  );
}
