import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { orgIsPro } from "@/lib/pro/gate";
import { getSupportRequest, listOrgSupportRequests, listSupportMessages, RESPONSE_TARGET_HOURS, SUPPORT_CATEGORIES } from "@/lib/pro/support";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewRequestForm, ReplyForm } from "./support-client";

export const metadata: Metadata = { title: "Help" };

export default async function SupportPage({ params, searchParams }: PageProps<"/org/[slug]/support">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const pro = orgIsPro(ctx.org);
  const openId = Number(sp.request) || null;
  const [requests, open] = await Promise.all([listOrgSupportRequests(ctx.org.id), openId ? getSupportRequest(openId) : Promise.resolve(null)]);
  const thread = open && Number(open.organization_id) === ctx.org.id ? open : null;
  const messages = thread ? await listSupportMessages(Number(thread.id)) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Help" description={pro
        ? `You are on Fattixx Pro: your requests go to the front of the queue. We aim to answer within ${RESPONSE_TARGET_HOURS.priority} business hours.`
        : `Ask the Fattixx team anything about your events, payments or account. We aim to answer within ${RESPONSE_TARGET_HOURS.normal} business hours; Fattixx Pro organizers are answered first.`} />

      {thread ? (
        <Section title={<span className="flex flex-wrap items-center gap-3">{thread.subject} <StatusBadge status={thread.status} />{thread.priority === "priority" ? <StatusBadge status="priority" /> : null}</span>}
          description={<>Opened {formatDate(thread.created_at)} by {thread.name ?? thread.email}. <Link href={`/org/${slug}/support`} className="underline">All requests</Link></>}>
          <ol className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className={m.from_staff ? "rounded-2xl border border-fx-yellow bg-fx-yellow/15 p-4" : "rounded-2xl border bg-white p-4"}>
                <p className="text-xs text-muted-foreground">{m.from_staff ? `Fattixx support${m.author_name ? ` · ${m.author_name}` : ""}` : m.author_name ?? "You"} · {formatDate(m.created_at)}</p>
                <p className="mt-1 text-sm whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4"><ReplyForm org={slug} requestId={Number(thread.id)} resolved={thread.status === "resolved"} /></div>
        </Section>
      ) : (
        <Section title="New request">
          <NewRequestForm org={slug} categories={SUPPORT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
        </Section>
      )}

      <Section title="Your requests">
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead>Opened</TableHead><TableHead>Last message</TableHead></TableRow></TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/org/${slug}/support?request=${r.id}`} className="font-medium hover:underline">{r.subject}</Link>{r.priority === "priority" ? <span className="ml-2 text-xs text-muted-foreground">Priority</span> : null}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.last_message_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
