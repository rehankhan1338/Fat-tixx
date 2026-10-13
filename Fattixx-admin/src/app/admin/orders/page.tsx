import type { Metadata } from "next";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { searchAllOrders } from "@/lib/orders/queries";
import { PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/components/orders-table";

export const metadata: Metadata = { title: "Orders" };

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requirePlatformStaff();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const orders = await searchAllOrders(q);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Orders & tickets" description="Support tools: search any order by order number, buyer name, email, attendee name or ticket code." />
      <Card><CardContent className="pt-6">
        <form className="mb-4 flex gap-2" action="/admin/orders">
          <Input name="q" defaultValue={q} placeholder="FTX-XXXXXX, email, name or ticket code" className="max-w-md" autoFocus />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <OrdersTable orders={orders} showOrg hrefFor={(o) => `/org/${o.org_slug}/orders/${o.code}`} />
      </CardContent></Card>
    </div>
  );
}
