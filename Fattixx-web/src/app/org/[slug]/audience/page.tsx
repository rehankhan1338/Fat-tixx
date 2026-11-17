import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { query, type Row } from "@/lib/db";
import { listVisibleEvents } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { audienceStats, listAudience, messageRecipients, parseAudienceFilters } from "@/lib/social/audience";
import { listReportsForOrg } from "@/lib/social/moderation";
import { syncContacts } from "@/lib/pro/email-marketing";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AudienceMessageForm, OrgReportActions } from "./audience-client";

export const metadata: Metadata = { title: "Audience" };

const PER_PAGE = 50;
const TABS = [
  { key: "people", label: "People" },
  { key: "message", label: "Message" },
  { key: "analytics", label: "Growth" },
  { key: "reports", label: "Feed reports" },
] as const;

/*
 * Organizer audience (Social & Community 11.10): followers and past attendees across all events, filters by event,
 * city and date; messages by email (and text for people who opted in); follower growth and sales from referrals and
 * shares; reports about posts in the organization's event feeds.
 */
export default async function AudiencePage({ params, searchParams }: PageProps<"/org/[slug]/audience">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "organizer");
  if (ctx.role === "staff") notFound();
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]["key"]) : "people";
  const filters = parseAudienceFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const [stats, events] = await Promise.all([audienceStats(ctx.org.id), listVisibleEvents(ctx, "all")]);
  const qs = (extra: Record<string, string | number | null>) => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") base[k] = v;
    for (const [k, v] of Object.entries(extra)) { if (v == null || v === "") delete base[k]; else base[k] = String(v); }
    return `?${new URLSearchParams(base).toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Audience" description="Your followers on Fattixx and everyone who bought tickets to your events." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Followers" value={stats.followers.toLocaleString()} hint={`+${stats.newFollowers30} in the last 30 days`} />
        <Stat label="Sales from referrals" value={formatCents(stats.referralSales.revenue)} hint={`${stats.referralSales.orders} orders`} />
        <Stat label="Sales from shares" value={formatCents(stats.shareSales.revenue)} hint={`${stats.shareSales.orders} orders · ${stats.shares} shares`} />
        <Stat label="Events" value={events.length} />
      </div>
      <nav aria-label="Audience" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link key={t.key} href={`/org/${slug}/audience?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</Link>
        ))}
      </nav>

      {tab === "people" || tab === "message" ? (
        <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6" action={`/org/${slug}/audience`}>
          <input type="hidden" name="tab" value={tab} />
          <label className="text-sm lg:col-span-1">Who<select name="kind" defaultValue={filters.kind} className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2"><option value="all">Everyone</option><option value="followers">Followers</option><option value="attendees">Past attendees</option></select></label>
          <label className="text-sm lg:col-span-2">Event<select name="event" defaultValue={filters.eventId ?? ""} className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2"><option value="">Any event</option>{events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
          <label className="text-sm">City<input name="city" defaultValue={filters.city} className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2" /></label>
          <label className="text-sm">From<input type="date" name="from" defaultValue={filters.from ?? ""} className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2" /></label>
          <label className="text-sm">To<input type="date" name="to" defaultValue={filters.to ?? ""} className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2" /></label>
          {tab === "people" ? <label className="text-sm lg:col-span-2">Search<input name="q" defaultValue={filters.q} placeholder="Name, email or @username" className="mt-1 block h-9 w-full rounded-md border bg-transparent px-2" /></label> : null}
          <div className="flex items-end gap-2"><Button type="submit" variant="outline">Filter</Button><Button variant="ghost" render={<Link href={`/org/${slug}/audience?tab=${tab}`} />}>Clear</Button></div>
        </form>
      ) : null}

      {tab === "people" ? await People(ctx.org.id, filters, page, qs) : null}
      {tab === "message" ? await Message(ctx.org.id, ctx.isOrgAdmin, slug, filters) : null}
      {tab === "analytics" ? <Growth stats={stats} /> : null}
      {tab === "reports" ? await Reports(slug) : null}
    </div>
  );
}

async function People(orgId: number, filters: ReturnType<typeof parseAudienceFilters>, page: number, qs: (x: Record<string, string | number | null>) => string) {
  await syncContacts(orgId);
  const { rows, total } = await listAudience(orgId, filters, PER_PAGE, (page - 1) * PER_PAGE);
  if (!total) return <EmptyState title="Nobody here yet" description="Followers and ticket buyers appear here." />;
  const pages = Math.ceil(total / PER_PAGE);
  return (
    <Section title={`${total.toLocaleString()} ${total === 1 ? "person" : "people"}`} description="Followers who never bought tickets show their name and city only.">
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>City</TableHead><TableHead>Follower</TableHead><TableHead className="text-right">Events</TableHead><TableHead>Last event</TableHead><TableHead>Updates</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="font-medium">{r.username ? <Link href={`/u/${r.username}`} target="_blank" className="hover:underline">{r.name}</Link> : r.name}</TableCell>
              <TableCell className="text-sm">{r.email ?? <span className="text-muted-foreground">hidden</span>}</TableCell>
              <TableCell className="text-sm">{r.city ?? "—"}</TableCell>
              <TableCell>{r.follower ? <Badge variant="outline">since {formatDate(r.followedAt)}</Badge> : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.events}</TableCell>
              <TableCell className="text-sm">{r.lastEventAt ? formatDate(r.lastEventAt) : "—"}</TableCell>
              <TableCell className="text-sm">{r.follower ? "Follows you" : r.optedIn ? "Opted in" : <span className="text-muted-foreground">No</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pages > 1 ? (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 ? <Button variant="outline" size="sm" render={<Link href={qs({ page: page - 1 })} />}>Previous</Button> : null}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Button variant="outline" size="sm" render={<Link href={qs({ page: page + 1 })} />}>Next</Button> : null}
        </div>
      ) : null}
    </Section>
  );
}

async function Message(orgId: number, isAdmin: boolean, slug: string, filters: ReturnType<typeof parseAudienceFilters>) {
  await syncContacts(orgId);
  const [recipients, history] = await Promise.all([
    messageRecipients(orgId, filters),
    query<Row & { id: number; subject: string; audience: string; email_count: number; sms_count: number; created_at: Date; sender: string | null }>(
      `SELECT m.id, m.subject, m.audience, m.email_count, m.sms_count, m.created_at, u.name AS sender FROM audience_messages m LEFT JOIN users u ON u.id = m.sent_by WHERE m.organization_id = ? ORDER BY m.id DESC LIMIT 20`, [orgId],
    ),
  ]);
  const sms = recipients.filter((r) => r.sms).length;
  return (
    <div className="space-y-6">
      <Section title="Send a message" description={`Reaches ${recipients.length} ${recipients.length === 1 ? "person" : "people"} with these filters: followers who haven’t muted you, and past attendees who asked for your updates at checkout. ${sms} can also get a text.`}>
        {isAdmin ? <AudienceMessageForm slug={slug} filters={filters} recipients={recipients.length} smsRecipients={sms} /> : <p className="text-sm text-muted-foreground">Only Organization Admins can send audience messages.</p>}
      </Section>
      <Section title="Sent">
        {history.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>To</TableHead><TableHead className="text-right">Emails</TableHead><TableHead className="text-right">Texts</TableHead><TableHead>Sent</TableHead></TableRow></TableHeader>
            <TableBody>{history.map((h) => <TableRow key={h.id}><TableCell className="font-medium">{h.subject}</TableCell><TableCell className="text-sm">{h.audience}</TableCell><TableCell className="text-right tabular-nums">{h.email_count}</TableCell><TableCell className="text-right tabular-nums">{h.sms_count}</TableCell><TableCell className="text-sm">{formatDate(h.created_at)}{h.sender ? ` · ${h.sender}` : ""}</TableCell></TableRow>)}</TableBody>
          </Table>
        ) : <p className="text-sm text-muted-foreground">No messages yet.</p>}
      </Section>
    </div>
  );
}

function Growth({ stats }: { stats: Awaited<ReturnType<typeof audienceStats>> }) {
  const max = Math.max(1, ...stats.growth.map((g) => g.count));
  return (
    <Section title="New followers per week" description="The last 12 weeks.">
      {stats.growth.length ? (
        <ul className="space-y-2">
          {stats.growth.map((g) => (
            <li key={g.week} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{formatDate(g.week)}</span>
              <span className="h-3 rounded bg-primary" style={{ width: `${Math.max(2, (g.count / max) * 100)}%` }} aria-hidden />
              <span className="tabular-nums">{g.count}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No new followers in the last 12 weeks.</p>}
      <p className="mt-6 text-sm">Sales from referral links: <b>{formatCents(stats.referralSales.revenue)}</b> ({stats.referralSales.orders} orders). Sales from “I’m going” shares: <b>{formatCents(stats.shareSales.revenue)}</b> ({stats.shareSales.orders} orders, {stats.shares} shares).</p>
    </Section>
  );
}

async function Reports(slug: string) {
  const reports = await listReportsForOrg(slug);
  if (!reports.length) return <EmptyState title="No reports" description="When someone reports a post in one of your event feeds, it shows here and Fattixx support is told too." />;
  return (
    <Section title="Reported posts" description="Fattixx support sees these reports too and can also act on them.">
      <Table>
        <TableHeader><TableRow><TableHead>Post</TableHead><TableHead>Event</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-[320px] text-sm"><span className="font-medium">{r.post_author ?? "Unknown"}:</span> <span className="line-clamp-3">{r.post_body ?? "(deleted)"}</span></TableCell>
              <TableCell className="text-sm">{r.event_slug ? <Link href={`/events/${r.event_slug}#feed`} target="_blank" className="hover:underline">{r.event_title}</Link> : "—"}</TableCell>
              <TableCell className="max-w-[240px] text-sm">{r.reason}</TableCell>
              <TableCell><StatusBadge status={r.status} />{r.resolution ? <div className="text-xs text-muted-foreground">{r.resolution}</div> : null}</TableCell>
              <TableCell className="text-right">{r.status === "open" ? <OrgReportActions slug={slug} reportId={Number(r.id)} /> : null}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}
