import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { requireOrg } from "@/lib/authz";
import { query, type Row } from "@/lib/db";
import { listVisibleEvents } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { deleteSegment, unsubscribeContact } from "@/lib/pro/email-actions";
import { audienceSize, contactCounts, listContacts, syncContacts } from "@/lib/pro/email-marketing";
import { orgIsPro } from "@/lib/pro/gate";
import { describeRules, parseRules } from "@/lib/pro/segments";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emailNav, ProUpsell, SubNav } from "@/components/pro/dashboard";
import { SegmentDialog } from "../email-client";

export const metadata: Metadata = { title: "Contacts & audiences" };

const PER_PAGE = 50;

export default async function AudiencePage({ params, searchParams }: PageProps<"/org/[slug]/email/audience">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const pro = orgIsPro(ctx.org);
  if (pro) await syncContacts(ctx.org.id);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = sp.status === "unsubscribed" ? "unsubscribed" : sp.status === "all" ? "all" : "subscribed";
  const page = Math.max(1, Number(sp.page) || 1);
  const [contacts, counts, segments, events] = await Promise.all([
    listContacts(ctx.org.id, { q, status, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    contactCounts(ctx.org.id),
    query<Row & { id: number; name: string; rules: string | object; updated_at: Date }>(`SELECT id, name, rules, updated_at FROM marketing_segments WHERE organization_id = ? ORDER BY name`, [ctx.org.id]),
    listVisibleEvents(ctx, "all"),
  ]);
  const eventList = events.map((e) => ({ id: Number(e.id), title: e.title }));
  const title = (id: number) => eventList.find((e) => e.id === id)?.title;
  const sized = await Promise.all(segments.map(async (s) => ({ ...s, parsed: parseRules(s.rules), size: await audienceSize(ctx.org.id, parseRules(s.rules)) })));
  const qs = (p: Record<string, string | number>) => `?${new URLSearchParams({ ...(q ? { q } : {}), status, page: String(page), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) })}`;
  const pages = Math.max(1, Math.ceil(contacts.total / PER_PAGE));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Contacts & audiences" description="Buyers who ticked “Email me about future events from this organizer” at checkout. People join when they opt in and leave when they unsubscribe; you cannot add anyone by hand."
        actions={<Button variant="outline" nativeButton={false} render={<a href={`/api/exports/contacts?org=${slug}`} />}><DownloadIcon /> Contacts CSV</Button>} />
      <SubNav items={emailNav(slug)} current={`/org/${slug}/email/audience`} />
      {!pro ? <ProUpsell ctx={ctx} feature="Email marketing" text="Build audiences from what people bought and send them campaigns." /> : null}

      <Section title="Audiences" description="Saved groups of subscribed contacts. Sizes are as of now; a campaign's list is fixed when it starts sending." actions={pro ? <SegmentDialog org={slug} events={eventList} /> : null}>
        {sized.length === 0 ? <p className="text-sm text-muted-foreground">No audiences yet. Campaigns can always go to everyone subscribed.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Audience</TableHead><TableHead>Rules</TableHead><TableHead className="text-right">Contacts</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {sized.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{describeRules(s.parsed, title)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.size.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {pro ? <SegmentDialog org={slug} events={eventList} segment={{
                        id: Number(s.id), name: s.name, eventIds: s.parsed.eventIds ?? [], excludeEventIds: s.parsed.excludeEventIds ?? [], minOrders: s.parsed.minOrders,
                        boughtWithinDays: s.parsed.boughtWithinDays, notBoughtWithinDays: s.parsed.notBoughtWithinDays,
                        minSpent: s.parsed.minSpentCents ? (s.parsed.minSpentCents / 100).toFixed(2) : undefined, cities: (s.parsed.cities ?? []).join(", "),
                      }} /> : null}
                      <ConfirmButton action={deleteSegment} fields={{ org: slug, segment_id: Number(s.id) }} title={`Delete “${s.name}”?`} description="Contacts are not affected." confirmText="Delete" variant="ghost">Delete</ConfirmButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title={`Contacts (${counts.subscribed.toLocaleString()} subscribed, ${counts.unsubscribed.toLocaleString()} unsubscribed)`}>
        <form className="mb-4 flex flex-wrap items-end gap-2" action={`/org/${slug}/email/audience`}>
          <input name="q" defaultValue={q} placeholder="Search name or email" className="h-10 min-w-[220px] flex-1 rounded-lg border bg-white px-3 text-sm" aria-label="Search contacts" />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border bg-white px-3 text-sm" aria-label="Show">
            <option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option><option value="all">All</option>
          </select>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        {contacts.rows.length === 0 ? <p className="text-sm text-muted-foreground">No contacts{q ? " match your search" : " yet"}. Buyers appear here once they opt in at checkout.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Consent</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Spent</TableHead><TableHead>Last order</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {contacts.rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><span className="font-medium">{c.name ?? "—"}</span><span className="block text-xs text-muted-foreground">{c.email}</span></TableCell>
                  <TableCell className="text-xs">
                    {c.unsubscribed_at ? <><StatusBadge status="canceled" /> <span className="block text-muted-foreground">Unsubscribed {formatDate(c.unsubscribed_at)} ({(c.unsubscribe_source ?? "link").replace("_", "-")})</span></>
                      : <span className="text-muted-foreground">Opted in {formatDate(c.consent_at)}<span className="block font-mono">{c.consent_source?.replace("checkout:", "Order ")}</span></span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Number(c.orders_count)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCents(Number(c.spent_cents))}</TableCell>
                  <TableCell className="text-sm">{formatDate(c.last_order_at)}</TableCell>
                  <TableCell className="text-right">
                    {!c.unsubscribed_at ? <ConfirmButton action={unsubscribeContact} fields={{ org: slug, contact_id: Number(c.id) }} title={`Unsubscribe ${c.email}?`} description="They will get no more marketing emails from you, unless they opt in again at a future checkout." confirmText="Unsubscribe" variant="ghost">Unsubscribe</ConfirmButton> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            {page > 1 ? <Link href={qs({ page: page - 1 })} className="underline">Previous</Link> : <span />}
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            {page < pages ? <Link href={qs({ page: page + 1 })} className="underline">Next</Link> : <span />}
          </div>
        ) : null}
      </Section>
    </div>
  );
}
