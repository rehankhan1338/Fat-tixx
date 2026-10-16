import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { countEmails, countSms, listEmails, listSms } from "@/lib/admin/queries";
import { isEmailConfigured } from "@/lib/email";
import { isSmsConfigured } from "@/lib/sms";
import { paginationParams, parsePagination } from "@/lib/pagination";
import { PageHeader, StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Emails" };

const SMS_PREFIX = "sms";

export default async function EmailsPage({ searchParams }: PageProps<"/admin/emails">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const emailPaging = parsePagination(sp);
  const smsPaging = parsePagination(sp, SMS_PREFIX);
  const [emails, emailTotal, sms, smsTotal, configured] = await Promise.all([
    listEmails(emailPaging.perPage, emailPaging.offset),
    countEmails(),
    listSms(smsPaging.perPage, smsPaging.offset),
    countSms(),
    isEmailConfigured(),
  ]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Email outbox" description="Every message the platform generates: tickets, receipts, invitations, password links, event updates." actions={<Button variant="outline" render={<Link href="/admin/emails/templates" />}>Edit templates</Button>} />
      {!configured ? (
        <Alert>
          <AlertTitle>No mail delivery configured</AlertTitle>
          <AlertDescription>Messages are recorded here with status “logged” but not delivered. Save a Brevo API key and sender under <Link href="/admin/settings?tab=integrations" className="underline">Settings → Integrations</Link> to send real email.</AlertDescription>
        </Alert>
      ) : null}
      <Card><CardContent className="space-y-4 pt-6">
        {emails.length === 0 ? <EmptyState title={emailTotal === 0 ? "No emails yet" : "No emails on this page"} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {emails.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.to_name ? <span className="font-medium">{e.to_name}</span> : null}<span className="block text-xs text-muted-foreground">{e.to_email}</span></TableCell>
                  <TableCell><Link href={`/admin/emails/${e.id}`} className="hover:underline">{e.subject}</Link>{e.error ? <span className="block text-xs text-destructive">{e.error}</span> : null}</TableCell>
                  <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                  <TableCell><StatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(e.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <TablePagination page={emailPaging.page} perPage={emailPaging.perPage} total={emailTotal} params={paginationParams(smsPaging, SMS_PREFIX)} />
      </CardContent></Card>
      <Card><CardContent className="space-y-4 pt-6">
        <div><p className="font-semibold">Text messages</p><p className="text-sm text-muted-foreground">{isSmsConfigured() ? "Sent through Twilio." : "No SMS provider configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM): messages are logged here only."} Buyers opt in at checkout.</p></div>
        {sms.length === 0 ? <p className="text-sm text-muted-foreground">{smsTotal === 0 ? "No text messages yet." : "No text messages on this page."}</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>To</TableHead><TableHead>Message</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>{sms.map((m) => <TableRow key={m.id}><TableCell className="font-mono text-xs">{m.to_phone}</TableCell><TableCell className="max-w-xl text-xs">{m.body}{m.error ? <span className="block text-destructive">{m.error}</span> : null}</TableCell><TableCell><StatusBadge status={m.status} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(m.created_at)}</TableCell></TableRow>)}</TableBody>
          </Table>
        )}
        <TablePagination page={smsPaging.page} perPage={smsPaging.perPage} total={smsTotal} prefix={SMS_PREFIX} params={paginationParams(emailPaging)} />
      </CardContent></Card>
    </div>
  );
}
