import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { query, type Row } from "@/lib/db";
import { STARTER_TEMPLATES } from "@/lib/pro/campaign-render";
import { deleteTemplate } from "@/lib/pro/email-actions";
import { orgIsPro } from "@/lib/pro/gate";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader, Section, formatDate } from "@/components/shared";
import { emailNav, ProUpsell, SubNav } from "@/components/pro/dashboard";
import { TemplateDialog } from "../email-client";

export const metadata: Metadata = { title: "Email templates" };

export default async function TemplatesPage({ params }: PageProps<"/org/[slug]/email/templates">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const pro = orgIsPro(ctx.org);
  const saved = await query<Row & { id: number; name: string; subject: string; body: string; updated_at: Date }>(
    `SELECT id, name, subject, body, updated_at FROM marketing_templates WHERE organization_id = ? ORDER BY name`, [ctx.org.id],
  );
  const card = "rounded-2xl border border-fx-red/10 bg-white p-4";
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Templates" description="Reusable starting points for your campaigns. Every email is sent in your colors with your logo." />
      <SubNav items={emailNav(slug)} current={`/org/${slug}/email/templates`} />
      {!pro ? <ProUpsell ctx={ctx} feature="Email marketing" text="Save your own templates and send campaigns to your past buyers." /> : null}

      <Section title="Your templates" actions={pro ? <TemplateDialog org={slug} /> : null}>
        {saved.length === 0 ? <p className="text-sm text-muted-foreground">None yet. Save a copy of a starter below, or create your own.</p> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {saved.map((t) => (
              <li key={t.id} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="font-semibold">{t.name}</p><p className="truncate text-sm text-muted-foreground">{t.subject}</p></div>
                  <div className="flex shrink-0 gap-1">
                    {pro ? <TemplateDialog org={slug} template={{ id: Number(t.id), name: t.name, subject: t.subject, body: t.body }} /> : null}
                    <ConfirmButton action={deleteTemplate} fields={{ org: slug, template_id: Number(t.id) }} title={`Delete “${t.name}”?`} description="Campaigns made from it are not affected." confirmText="Delete" variant="ghost">Delete</ConfirmButton>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{t.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">Edited {formatDate(t.updated_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Starters" description="Available to every Pro organizer.">
        <ul className="grid gap-3 md:grid-cols-3">
          {STARTER_TEMPLATES.map((t) => (
            <li key={t.key} className={card}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-semibold">{t.name}</p><p className="text-sm text-muted-foreground">{t.subject}</p></div>
                {pro ? <TemplateDialog org={slug} from={t} /> : null}
              </div>
              <p className="mt-2 line-clamp-4 text-sm whitespace-pre-line text-muted-foreground">{t.body}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
