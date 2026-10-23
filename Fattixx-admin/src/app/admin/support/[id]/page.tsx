import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { getSupportRequest, isOverdue, listSupportMessages } from "@/lib/pro/support";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { StaffReplyForm, StaffUpdateForm } from "./support-forms";

export const metadata: Metadata = { title: "Support request" };

export default async function SupportRequestPage({ params }: PageProps<"/admin/support/[id]">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const { id } = await params;
  const r = await getSupportRequest(Number(id));
  if (!r) notFound();
  const messages = await listSupportMessages(Number(r.id));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{r.subject} <StatusBadge status={r.status} />{r.priority === "priority" ? <StatusBadge status="priority" /> : null}</span>}
        description={<>{r.name ?? "—"} &lt;{r.email}&gt;{r.org_slug ? <> · <Link href={`/admin/organizations/${r.org_slug}`} className="underline">{r.org_name}</Link></> : null} · {r.category} · opened {formatDate(r.created_at)}{isOverdue(r) ? " · past response target" : ""}</>}
        actions={<Link href="/admin/support" className="text-sm underline">Back to the queue</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Section title="Conversation">
          <ol className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className={m.from_staff ? "rounded-xl border border-sky-500/30 bg-sky-500/5 p-4" : "rounded-xl border p-4"}>
                <p className="text-xs text-muted-foreground">{m.from_staff ? `Staff · ${m.author_name ?? "—"}` : m.author_name ?? r.email} · {formatDate(m.created_at)}</p>
                <p className="mt-1 text-sm whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4"><StaffReplyForm requestId={Number(r.id)} /></div>
        </Section>
        <Section title="Request">
          <StaffUpdateForm requestId={Number(r.id)} status={r.status} priority={r.priority} assignee={r.assignee_name} />
          <p className="mt-3 text-xs text-muted-foreground">First reply: {formatDate(r.first_response_at)}. Resolved: {formatDate(r.resolved_at)}.</p>
        </Section>
      </div>
    </div>
  );
}
