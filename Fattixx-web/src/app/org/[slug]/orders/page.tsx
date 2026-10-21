import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/authz";
import { listOrgOrders, ORDER_SORTS, type OrderSort } from "@/lib/orders/queries";
import { listOrgEvents } from "@/lib/events/queries";
import { PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { OrdersTable } from "@/components/orders-table";

export const metadata: Metadata = { title: "Orders" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function OrgOrdersPage({ params, searchParams }: PageProps<"/org/[slug]/orders">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "organizer");
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = str("q");
  const eventId = /^\d+$/.test(str("event")) ? Number(str("event")) : undefined;
  const from = DATE_RE.test(str("from")) ? str("from") : "";
  const to = DATE_RE.test(str("to")) ? str("to") : "";
  const sort: OrderSort = str("sort") in ORDER_SORTS ? (str("sort") as OrderSort) : "newest";
  const [orders, events] = await Promise.all([
    listOrgOrders(ctx.org.id, { search: q, eventId, from, to, sort }),
    listOrgEvents(ctx.org.id),
  ]);
  const filtered = Boolean(q || eventId || from || to || sort !== "newest");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Orders" description="Search by order number, buyer, attendee name or ticket code. Open an order to resend tickets, edit names or refund." />
      <Card><CardContent className="pt-6">
        <form className="mb-4 flex flex-wrap items-end gap-3" action={`/org/${slug}/orders`}>
          <label className="grid gap-1 text-xs text-muted-foreground">Search
            <Input name="q" defaultValue={q} placeholder="FTX-XXXXXX, email, name or ticket code" className="w-72" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Event
            <NativeSelect name="event" defaultValue={eventId ? String(eventId) : ""} className="w-56">
              <option value="">All events</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">From
            <Input type="date" name="from" defaultValue={from} className="w-40" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">To
            <Input type="date" name="to" defaultValue={to} className="w-40" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Sort by
            <NativeSelect name="sort" defaultValue={sort} className="w-48">
              {(Object.entries(ORDER_SORTS) as [OrderSort, { label: string }][]).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </NativeSelect>
          </label>
          <Button type="submit" variant="secondary">Apply</Button>
          {filtered ? <Button variant="ghost" render={<Link href={`/org/${slug}/orders`} />}>Clear</Button> : null}
        </form>
        <OrdersTable orders={orders} hrefFor={(o) => `/org/${slug}/orders/${o.code}`} />
      </CardContent></Card>
    </div>
  );
}
