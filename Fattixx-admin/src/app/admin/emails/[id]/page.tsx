import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { getEmail } from "@/lib/admin/queries";
import { resendEmail } from "@/lib/admin/actions";
import { isEmailConfigured } from "@/lib/email";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata: Metadata = { title: "Email" };

export default async function EmailPage({ params }: PageProps<"/admin/emails/[id]">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const { id } = await params;
  const [email, configured] = await Promise.all([getEmail(Number(id)), isEmailConfigured()]);
  if (!email) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/admin/emails" />}><ArrowLeftIcon /> Outbox</Button>
      <PageHeader
        title={email.subject}
        description={<>To {email.to_name ? `${email.to_name} <${email.to_email}>` : email.to_email} · {formatDate(email.created_at)} · <StatusBadge status={email.status} /></>}
        actions={configured ? <ConfirmButton action={resendEmail} fields={{ id: email.id }} title="Resend this email?" confirmText="Resend" variant="outline" successText="Sent">Resend</ConfirmButton> : null}
      />
      {email.error ? <p className="text-sm text-destructive">Last error: {email.error}</p> : null}
      <Section>
        <Tabs defaultValue={email.html_body ? "html" : "text"}>
          <TabsList><TabsTrigger value="html" disabled={!email.html_body}>HTML preview</TabsTrigger><TabsTrigger value="text">Plain text</TabsTrigger></TabsList>
          <TabsContent value="html" className="pt-4">
            {email.html_body ? <iframe title="Email preview" sandbox="" srcDoc={email.html_body} className="h-[600px] w-full rounded-lg border bg-white" /> : null}
          </TabsContent>
          <TabsContent value="text" className="pt-4"><pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-xs">{email.text_body}</pre></TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
