import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { listReportsForStaff } from "@/lib/social/moderation";
import { EmptyState, PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Reports" };

/*
 * Reported posts and profiles (Social & Community 11.11). Support can remove the content (a post, or a profile's photo,
 * bio and links), suspend the account (signs them out everywhere) or dismiss. Every action is in the audit log.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const all = sp.status === "all";
  const reports = await listReportsForStaff(all ? "all" : "open");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Reports" description="Posts in event feeds and attendee profiles that someone reported."
        actions={<Button variant="outline" render={<Link href={all ? "/admin/reports" : "/admin/reports?status=all"} />}>{all ? "Open only" : "Show all"}</Button>} />
      {reports.length === 0 ? <EmptyState title="Nothing to review" description="New reports appear here and are emailed to Support." /> : (
        <Section>
          <Table>
            <TableHeader><TableRow><TableHead>Reported</TableHead><TableHead>Where</TableHead><TableHead>Reason</TableHead><TableHead>By</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[340px] text-sm">
                    {r.target_type === "post"
                      ? <><span className="font-medium">Post by {r.post_author ?? "unknown"}:</span> <span className="line-clamp-3">{r.post_body ?? "(deleted)"}</span></>
                      : <><span className="font-medium">Profile:</span> {r.profile_username ? <a href={`${env.APP_URL}/u/${r.profile_username}`} target="_blank" rel="noreferrer" className="underline">{r.profile_name} (@{r.profile_username})</a> : r.profile_name ?? "(removed)"}</>}
                  </TableCell>
                  <TableCell className="text-sm">{r.event_slug ? <a href={`${env.APP_URL}/events/${r.event_slug}#feed`} target="_blank" rel="noreferrer" className="underline">{r.event_title}</a> : "—"}</TableCell>
                  <TableCell className="max-w-[260px] text-sm">{r.reason}</TableCell>
                  <TableCell className="text-sm">{r.reporter_name ?? "—"}<div className="text-xs text-muted-foreground">{formatDate(r.created_at)}</div></TableCell>
                  <TableCell><StatusBadge status={r.status} />{r.resolution ? <div className="text-xs text-muted-foreground">{r.resolution}</div> : null}</TableCell>
                  <TableCell className="text-right">{r.status === "open" ? <ReportActions id={Number(r.id)} canSuspend={r.target_type === "profile" || r.post_author_id != null} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}
