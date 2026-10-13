import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { TEMPLATES, listStoredTemplates } from "@/lib/email-templates";
import { PageHeader } from "@/components/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Email templates" };

export default async function EmailTemplatesPage() {
  await requireSuperAdmin();
  const stored = await listStoredTemplates();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Email templates" description="Edit the subject and body of every email the platform sends. Placeholders in double braces are filled in automatically; the preview uses sample data and your current branding." />
      <Tabs value="templates">
        <TabsList>
          <TabsTrigger nativeButton={false} value="outbox" render={<Link href="/admin/emails" />}>Outbox</TabsTrigger>
          <TabsTrigger nativeButton={false} value="templates" render={<Link href="/admin/emails/templates" />}>Templates</TabsTrigger>
        </TabsList>
      </Tabs>
      <TemplateEditor templates={TEMPLATES.map((t) => {
        const s = stored.get(t.key);
        return { key: t.key, name: t.name, description: t.description, variables: t.variables, defaultSubject: t.subject, defaultBody: t.body, subject: s?.subject ?? t.subject, body: s?.body_html ?? t.body, customized: !!s, updatedAt: s ? new Date(s.updated_at).toLocaleString() : null, updatedBy: s?.updated_by_name ?? null };
      })} />
    </div>
  );
}
