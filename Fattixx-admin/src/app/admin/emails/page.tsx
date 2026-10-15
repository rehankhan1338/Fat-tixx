import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { listEmails } from "@/lib/admin/queries";
import { isSmtpConfigured } from "@/lib/email";
import { isSmsConfigured } from "@/lib/sms";
import { query, type Row } from "@/lib/db";
import { PageHeader, StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Emails" };

export default async function EmailsPage() {
  await requirePlatformStaff(["super_admin", "support"]);
  const [emails, sms] = await Promise.all([listEmails(150), query<Row & { id: number; to_phone: string; body: string; status: string; error: string | null; created_at: Date }>(`SELECT id, to_phone, body, status, error, created_at FROM sms_outbox ORDER BY id DESC LIMIT 50`)]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Email outbox" description="Every message the platform generates: tickets, receipts, invitations, password links, event updates." actions={<Button variant="outline" render={<Link href="/admin/emails/templates" />}>Edit templates</Button>} />
      {!isSmtpConfigured() ? (
        <Alert>
          <AlertTitle>No mail server configured</AlertTitle>
          <AlertDescription>Messages are recorded here with status “logged” but not delivered. Add <code className="font-mono">BREVO_API_KEY</code> and <code className="font-mono">MAIL_FROM</code> to .env.local and restart to send real email.</AlertDescription>
        </Alert>
      ) : null}
      <Card><CardContent className="pt-6">
        {emails.length === 0 ? <EmptyState title="No emails yet" /> : (
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
      </CardContent></Card>
      <Card><CardContent className="space-y-3 pt-6">
        <div><p className="font-semibold">Text messages</p><p className="text-sm text-muted-foreground">{isSmsConfigured() ? "Sent through Twilio." : "No SMS provider configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM): messages are logged here only."} Buyers opt in at checkout.</p></div>
        {sms.length === 0 ? <p className="text-sm text-muted-foreground">No text messages yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>To</TableHead><TableHead>Message</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>{sms.map((m) => <TableRow key={m.id}><TableCell className="font-mono text-xs">{m.to_phone}</TableCell><TableCell className="max-w-xl text-xs">{m.body}{m.error ? <span className="block text-destructive">{m.error}</span> : null}</TableCell><TableCell><StatusBadge status={m.status} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(m.created_at)}</TableCell></TableRow>)}</TableBody>
          </Table>
        )}
      </CardContent></Card>
    </div>
  );
}
