import Link from "next/link";
import type { OrderListRow } from "@/lib/orders/queries";
import { formatCents } from "@/lib/money";
import { StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function OrdersTable({ orders, hrefFor, showOrg = false }: { orders: OrderListRow[]; hrefFor: (o: OrderListRow) => string; showOrg?: boolean }) {
  if (orders.length === 0) return <EmptyState title="No orders found" description="Orders appear here once tickets are sold or issued." />;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Buyer</TableHead><TableHead>Event</TableHead>{showOrg ? <TableHead>Organization</TableHead> : null}<TableHead>Status</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell><Link href={hrefFor(o)} className="font-mono text-xs hover:underline">{o.code}</Link>{o.source !== "online" ? <Badge variant="outline" className="ml-2 text-[10px]">{o.source.replace("_", " ")}</Badge> : null}</TableCell>
            <TableCell>{o.buyer_name ? <span className="font-medium">{o.buyer_name}</span> : null}<span className="block text-xs text-muted-foreground">{o.buyer_email}</span></TableCell>
            <TableCell className="max-w-56 truncate">{o.event_title}</TableCell>
            {showOrg ? <TableCell className="text-muted-foreground">{o.org_name}</TableCell> : null}
            <TableCell><StatusBadge status={o.status} /></TableCell>
            <TableCell className="text-right tabular-nums">{o.ticket_count}</TableCell>
            <TableCell className="text-right font-mono">{formatCents(Number(o.total_cents), o.currency)}{Number(o.refunded_cents) ? <span className="block text-xs text-destructive">−{formatCents(Number(o.refunded_cents), o.currency)}</span> : null}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(o.paid_at ?? o.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
