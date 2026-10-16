import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { query, queryOne, type Row } from "@/lib/db";
import { parsePagination } from "@/lib/pagination";
import { PageHeader, Section, StatusBadge, EmptyState, formatDate } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { ReviewButtons } from "./review-buttons";

export const metadata: Metadata = { title: "Organizer applications" };

type App = Row & {
  id: number; contact_name: string; contact_email: string; contact_phone: string | null; org_name: string; legal_name: string; business_type: string; tax_id_last4: string | null;
  website: string | null; address: string | null; expected_events: string | null; status: string; review_notes: string | null; reviewed_at: Date | null; reviewer: string | null;
  created_at: Date; org_slug: string | null; ip: string | null; same_email_orgs: number;
};

const APP_SELECT = `SELECT a.*, u.name AS reviewer, g.slug AS org_slug,
            (SELECT COUNT(*) FROM organizations o WHERE o.contact_email = a.contact_email) AS same_email_orgs
       FROM organizer_applications a LEFT JOIN users u ON u.id = a.reviewed_by LEFT JOIN organizations g ON g.id = a.organization_id`;

export default async function ApplicationsPage({ searchParams }: PageProps<"/admin/applications">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const { page, perPage, offset } = parsePagination(sp);
  const [pending, done, doneTotalRow] = await Promise.all([
    query<App>(`${APP_SELECT} WHERE a.status = 'pending' ORDER BY a.created_at DESC`),
    query<App>(`${APP_SELECT} WHERE a.status <> 'pending' ORDER BY a.reviewed_at DESC, a.created_at DESC LIMIT ? OFFSET ?`, [perPage, offset]),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM organizer_applications WHERE status <> 'pending'`),
  ]);
  const doneTotal = Number(doneTotalRow?.n ?? 0);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Organizer applications" description="Verify identity and business details before an organizer can sell. Approving creates a verified organization with the applicant as its Organization Admin." />
      <Section title={`Waiting for review (${pending.length})`} description="Checklist: legal name matches the website / public records, the address is real, the tax ID last 4 matches what the applicant sends on request, and the email domain fits the business.">
        {pending.length === 0 ? <EmptyState title="Nothing to review" /> : (
          <ul className="space-y-4">
            {pending.map((a) => (
              <li key={a.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-lg font-semibold">{a.org_name}</p><p className="text-sm text-muted-foreground">{a.legal_name} · <span className="capitalize">{a.business_type}</span> · applied {formatDate(a.created_at)}</p></div>
                  {Number(a.same_email_orgs) ? <StatusBadge status="pending" /> : null}
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div><dt className="inline text-muted-foreground">Contact: </dt><dd className="inline">{a.contact_name} · <a href={`mailto:${a.contact_email}`} className="underline">{a.contact_email}</a>{a.contact_phone ? ` · ${a.contact_phone}` : ""}</dd></div>
                  <div><dt className="inline text-muted-foreground">Tax ID last 4: </dt><dd className="inline font-mono">{a.tax_id_last4 ?? "not given"}</dd></div>
                  <div><dt className="inline text-muted-foreground">Website: </dt><dd className="inline">{a.website ? <a href={a.website} target="_blank" rel="noopener noreferrer" className="underline">{a.website}</a> : "none"}</dd></div>
                  <div><dt className="inline text-muted-foreground">Address: </dt><dd className="inline">{a.address}</dd></div>
                  {a.expected_events ? <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Events: </dt><dd className="inline">{a.expected_events}</dd></div> : null}
                  {Number(a.same_email_orgs) ? <div className="sm:col-span-2 text-amber-700 dark:text-amber-300">This email already manages {a.same_email_orgs} organization(s).</div> : null}
                  <div className="sm:col-span-2 text-xs text-muted-foreground">Submitted from IP {a.ip ?? "unknown"}</div>
                </dl>
                <ReviewButtons id={Number(a.id)} name={a.org_name} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      {doneTotal > 0 ? (
        <Section title={`Reviewed (${doneTotal.toLocaleString()})`}>
          {done.length === 0 ? <p className="text-sm text-muted-foreground">No reviewed applications on this page.</p> : (
            <ul className="divide-y text-sm">
              {done.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{a.org_slug ? <Link href={`/admin/organizations/${a.org_slug}`} className="font-medium hover:underline">{a.org_name}</Link> : <span className="font-medium">{a.org_name}</span>} · {a.contact_email}{a.review_notes ? <span className="block text-xs text-muted-foreground">{a.review_notes}</span> : null}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground"><StatusBadge status={a.status} /> {a.reviewer ?? ""} · {formatDate(a.reviewed_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4"><TablePagination page={page} perPage={perPage} total={doneTotal} /></div>
        </Section>
      ) : null}
    </div>
  );
}
