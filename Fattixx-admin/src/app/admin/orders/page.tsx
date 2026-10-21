import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { countAllOrders, listEventsForFilter, ORDER_SORTS, searchAllOrders, type OrderSort } from "@/lib/orders/queries";
import { DEFAULT_PER_PAGE, parsePagination } from "@/lib/pagination";
import { PageHeader } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { OrdersTable } from "@/components/orders-table";

export const metadata: Metadata = { title: "Orders" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requirePlatformStaff();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = str("q");
  const eventId = /^\d+$/.test(str("event")) ? Number(str("event")) : undefined;
  const from = DATE_RE.test(str("from")) ? str("from") : "";
  const to = DATE_RE.test(str("to")) ? str("to") : "";
  const sort: OrderSort = str("sort") in ORDER_SORTS ? (str("sort") as OrderSort) : "newest";
  const filters = { search: q, eventId, from, to, sort };
  const { page, perPage, offset } = parsePagination(sp);
  const [orders, total, events] = await Promise.all([searchAllOrders(filters, perPage, offset), countAllOrders(filters), listEventsForFilter()]);
  const filtered = Boolean(q || eventId || from || to || sort !== "newest");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Orders & tickets" description="Support tools: search any order by order number, buyer name, email, attendee name or ticket code." />
      <Card><CardContent className="space-y-4 pt-6">
        <form className="flex flex-wrap items-end gap-3" action="/admin/orders">
          <label className="grid gap-1 text-xs text-muted-foreground">Search
            <Input name="q" defaultValue={q} placeholder="FTX-XXXXXX, email, name or ticket code" className="w-72" autoFocus />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">Event
            <NativeSelect name="event" defaultValue={eventId ? String(eventId) : ""} className="w-64">
              <option value="">All events</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.title} — {e.org_name}</option>)}
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
          {perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="per" value={perPage} /> : null}
          <Button type="submit" variant="secondary">Apply</Button>
          {filtered ? <Button variant="ghost" render={<Link href="/admin/orders" />}>Clear</Button> : null}
        </form>
        <OrdersTable orders={orders} showOrg hrefFor={(o) => `/org/${o.org_slug}/orders/${o.code}`} />
        <TablePagination page={page} perPage={perPage} total={total} params={{ q, event: eventId ? String(eventId) : "", from, to, sort }} />
      </CardContent></Card>
    </div>
  );
}
