import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { env } from "@/lib/env";
import { checkCustomDomain, removeCustomDomain } from "@/lib/pro/site-actions";
import { dnsTargets, getOrgDomain, verificationValue } from "@/lib/pro/domains";
import { looksLikeApex, txtRecordName } from "@/lib/pro/domain-names";
import { orgIsPro } from "@/lib/pro/gate";
import { ConfirmButton } from "@/components/confirm-button";
import { CopyButton } from "@/components/copy-button";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionButton } from "@/components/pro/action-button";
import { proNav, ProUpsell, SubNav } from "@/components/pro/dashboard";
import { AddDomainForm } from "./domain-form";

export const metadata: Metadata = { title: "Custom domain" };

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <span className="inline-flex items-center gap-2 text-sm"><span aria-hidden="true">{ok ? "✓" : "○"}</span>{label}</span>;
}

export default async function DomainPage({ params }: PageProps<"/org/[slug]/pro/domain">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  const pro = orgIsPro(ctx.org);
  const d = await getOrgDomain(ctx.org.id);
  const t = dnsTargets();
  const apex = d ? looksLikeApex(d.hostname) : false;
  const fields = { org: slug };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Custom domain" description="Sell from your own address, like tickets.yourbrand.com. You keep the domain; Fattixx sets up the secure connection." />
      <SubNav items={proNav(slug)} current={`/org/${slug}/pro/domain`} />
      {!pro ? <ProUpsell ctx={ctx} feature="A custom domain" text={d ? "Your domain is not serving pages while you are not on Pro: visitors go to your normal Fattixx address. It stays reserved for you for 30 days." : "Sell tickets from your own web address with a secure connection."} /> : null}

      {!d ? (
        pro ? (
          <Section title="Add your domain" description="Use a subdomain you own, such as tickets.yourbrand.com. Your main website keeps working as it is.">
            <AddDomainForm org={slug} />
          </Section>
        ) : null
      ) : (
        <>
          <Section
            title={<span className="flex flex-wrap items-center gap-3">{d.hostname} <StatusBadge status={d.status === "active" && d.ssl_status === "issued" ? "active" : d.status} /></span>}
            description={d.status === "active" && d.ssl_status === "issued" ? `Live at https://${d.hostname}. Your event pages are at https://${d.hostname}/events/<event>.` : "Add the DNS records below at the company where you bought the domain, then check."}
            actions={<>
              {pro ? <ActionButton action={checkCustomDomain} fields={fields}>Check now</ActionButton> : null}
              <ConfirmButton action={removeCustomDomain} fields={fields} title={`Remove ${d.hostname}?`} description="Visitors to this address will no longer reach your pages. Links using your normal Fattixx address keep working." confirmText="Remove">Remove</ConfirmButton>
            </>}
          >
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Check ok={!!d.txt_ok} label="Ownership confirmed (TXT)" />
              <Check ok={!!d.dns_ok} label="Pointing at Fattixx" />
              <Check ok={d.ssl_status === "issued"} label={d.ssl_status === "pending" ? "Secure certificate: being issued" : d.ssl_status === "failed" ? "Secure certificate: failed" : "Secure certificate"} />
            </div>
            {d.status === "failed" || d.last_error ? <Alert variant="destructive" className="mt-4"><AlertDescription>{d.last_error ?? "This domain was switched off. Check the records and try again."}</AlertDescription></Alert> : null}
            {d.failing_since && d.status === "active" ? <Alert className="mt-4"><AlertDescription>The DNS records for this domain disappeared on {formatDate(d.failing_since)}. Restore them within 3 days or the domain stops working.</AlertDescription></Alert> : null}
            <p className="mt-3 text-xs text-muted-foreground">Last checked {formatDate(d.checked_at)}. DNS changes can take up to an hour to be visible. Fattixx checks active domains every day.</p>
          </Section>

          <Section title="DNS records" description="Add both records in your domain's DNS settings. Keep the TXT record: it proves the domain is yours, so nobody else can claim it.">
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Name / host</TableHead><TableHead>Value</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono">TXT</TableCell>
                  <TableCell className="font-mono text-xs break-all">{txtRecordName(d.hostname)}</TableCell>
                  <TableCell className="font-mono text-xs break-all">{verificationValue(d)}</TableCell>
                  <TableCell className="text-right"><CopyButton value={verificationValue(d)} label="Copy" /></TableCell>
                </TableRow>
                {apex ? (
                  <TableRow>
                    <TableCell className="font-mono">A</TableCell>
                    <TableCell className="font-mono text-xs break-all">{d.hostname} (or @)</TableCell>
                    <TableCell className="font-mono text-xs">{t.a}</TableCell>
                    <TableCell className="text-right"><CopyButton value={t.a} label="Copy" /></TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell className="font-mono">CNAME</TableCell>
                    <TableCell className="font-mono text-xs break-all">{d.hostname}</TableCell>
                    <TableCell className="font-mono text-xs">{t.cname}</TableCell>
                    <TableCell className="text-right"><CopyButton value={t.cname} label="Copy" /></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              Some DNS providers want only the first part of the name (e.g. <span className="font-mono">{txtRecordName(d.hostname).split(".").slice(0, -2).join(".")}</span>).
              {apex ? " Root domains need an A record; a subdomain like tickets." + d.hostname + " is usually easier." : ""}
            </p>
          </Section>

          <Section title="How visitors are handled">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li><span className="font-mono">https://{d.hostname}/</span> shows your organizer page with your upcoming events.</li>
              <li>Your event pages, checkout and tickets work on your domain. Other Fattixx pages go to {new URL(env.APP_URL).host}.</li>
              <li>Events of other organizers never open on your domain.</li>
              <li>If Pro ends or the records are removed, visitors are sent to your normal Fattixx address, so links you shared keep working.</li>
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
