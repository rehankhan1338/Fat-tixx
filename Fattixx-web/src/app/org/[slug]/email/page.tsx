import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { requireOrg } from "@/lib/authz";
import { query } from "@/lib/db";
import { campaignStats, contactCounts, syncContacts, type CampaignRow } from "@/lib/pro/email-marketing";
import { orgIsPro } from "@/lib/pro/gate";
import { PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emailNav, ProUpsell, SubNav } from "@/components/pro/dashboard";
import { MailingAddressForm } from "./email-client";

export const metadata: Metadata = { title: "Email marketing" };

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

export default async function EmailPage({ params }: PageProps<"/org/[slug]/email">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const pro = orgIsPro(ctx.org);
  if (pro) await syncContacts(ctx.org.id);
  const [campaigns, counts] = await Promise.all([
    query<CampaignRow>(`SELECT * FROM marketing_campaigns WHERE organization_id = ? ORDER BY COALESCE(finished_at, scheduled_at, updated_at) DESC LIMIT 100`, [ctx.org.id]),
    contactCounts(ctx.org.id),
  ]);
  const stats = await campaignStats(campaigns.map((c) => Number(c.id)));
  const sent = campaigns.filter((c) => c.status === "sent");
  const totals = sent.reduce((a, c) => { const s = stats.get(Number(c.id)); return s ? { sent: a.sent + s.sent, opened: a.opened + s.opened, clicked: a.clicked + s.clicked } : a; }, { sent: 0, opened: 0, clicked: 0 });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Email marketing" description="Announce events to past buyers who asked to hear from you, with scheduling and open and click stats."
        actions={pro ? <Button nativeButton={false} render={<Link href={`/org/${slug}/email/new`} />}><PlusIcon /> New campaign</Button> : null} />
      <SubNav items={emailNav(slug)} current={`/org/${slug}/email`} />
      {!pro ? <ProUpsell ctx={ctx} feature="Email marketing" text="Email the buyers who opted in at checkout. Your contacts, campaigns and stats are kept if you are not on Pro; sending needs Pro." /> : null}
      {pro && !ctx.org.mailing_address ? (
        <Section title="Add your mailing address" description="The law (CAN-SPAM) requires a postal address in every marketing email. It is printed in the email footer.">
          {ctx.isOrgAdmin ? <MailingAddressForm org={slug} value="" /> : <p className="text-sm text-muted-foreground">Ask your Organization Admin to add it.</p>}
        </Section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Subscribed contacts" value={counts.subscribed.toLocaleString()} hint={`${counts.unsubscribed.toLocaleString()} unsubscribed`} />
        <Stat label="Campaigns sent" value={sent.length} />
        <Stat label="Open rate" value={pct(totals.opened, totals.sent)} hint="Approximate: some mail apps load images automatically" />
        <Stat label="Click rate" value={pct(totals.clicked, totals.sent)} />
      </div>

      <Section title="Campaigns">
        {campaigns.length === 0 ? <p className="text-sm text-muted-foreground">No campaigns yet.{pro ? " Start with a template: they are on the next page." : ""}</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Recipients</TableHead><TableHead className="text-right">Opened</TableHead><TableHead className="text-right">Clicked</TableHead><TableHead className="text-right">Unsubscribed</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const s = stats.get(Number(c.id));
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/org/${slug}/email/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      <span className="block text-xs text-muted-foreground">
                        {c.status === "scheduled" ? `Sends ${formatDate(c.scheduled_at)}` : c.status === "sent" ? `Sent ${formatDate(c.finished_at)}` : c.status === "paused" ? c.paused_reason ?? "Paused" : `Edited ${formatDate(c.updated_at)}`}
                      </span>
                    </TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">{s ? s.recipients.toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s ? pct(s.opened, s.sent) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s ? pct(s.clicked, s.sent) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s ? s.unsubscribed : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      {ctx.org.mailing_address ? (
        <Section title="Mailing address" description="Printed in the footer of every marketing email, as the law requires.">
          {ctx.isOrgAdmin ? <MailingAddressForm org={slug} value={ctx.org.mailing_address} /> : <p className="text-sm">{ctx.org.mailing_address}</p>}
        </Section>
      ) : null}
    </div>
  );
}
