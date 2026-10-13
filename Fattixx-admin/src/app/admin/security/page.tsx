import type { Metadata } from "next";
import { Trash2Icon, XIcon } from "lucide-react";
import { hasPlatformRole, requirePlatformStaff } from "@/lib/auth/guard";
import { revokeOtherSession } from "@/lib/auth/actions";
import { clearLoginAttempts, deleteLoginAttempt } from "@/lib/admin/actions";
import { countLoginAttempts, listUserSessions, recentLoginAttempts } from "@/lib/auth/queries";
import { parsePagination } from "@/lib/pagination";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { TablePagination } from "@/components/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RevokeAllButton } from "./revoke-all-button";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: PageProps<"/admin/security">) {
  const session = await requirePlatformStaff();
  const sp = await searchParams;
  const { page, perPage, offset } = parsePagination(sp);
  const canClear = hasPlatformRole(session, "super_admin");
  const [sessions, attempts, totalAttempts] = await Promise.all([
    listUserSessions(session.user.id),
    recentLoginAttempts(perPage, offset),
    countLoginAttempts(),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Security" description="Your active sessions and recent sign-in attempts across the platform." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Password protection">
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>Hashing: Argon2id, 64 MiB memory, 3 passes</li>
            <li>Minimum length: 12 characters</li>
            <li>Checked against known breached passwords</li>
            <li>Lockout: 5 failed attempts → 15 min, doubling</li>
          </ul>
        </Section>
        <Section title="Session policy">
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>Absolute lifetime: 12 hours · idle timeout: 30 minutes</li>
            <li>Cookie: HttpOnly · SameSite=Strict · Secure (prod)</li>
            <li>Tokens stored hashed (SHA-256)</li>
          </ul>
        </Section>
        <Section title="Revoke every other session" description="Signs out every device except this one. Requires a sign-in within the last 10 minutes.">
          <RevokeAllButton />
        </Section>
      </div>

      <Section title={`Your active sessions (${sessions.length})`}>
        <Table>
          <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>IP</TableHead><TableHead>Signed in</TableHead><TableHead>Last seen</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {sessions.map((s) => {
              const current = s.id === session.id;
              return (
                <TableRow key={s.id}>
                  <TableCell title={s.user_agent ?? ""}>{current ? <Badge variant="outline" className="mr-2 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">This device</Badge> : null}{shortUa(s.user_agent)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{s.ip ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.last_seen_at)}</TableCell>
                  <TableCell className="text-right">{current ? null : (
                    <form action={revokeOtherSession}><input type="hidden" name="sessionId" value={s.id} /><Button type="submit" variant="outline" size="sm">Revoke</Button></form>
                  )}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      <Section
        title="Sign-in attempts (all accounts)"
        description={totalAttempts > 0 ? `${totalAttempts.toLocaleString()} recorded. Attempts older than 30 days are pruned automatically.` : undefined}
        actions={canClear && totalAttempts > 0 ? (
          <ConfirmButton
            action={clearLoginAttempts}
            title="Clear all sign-in attempts?"
            description={`All ${totalAttempts.toLocaleString()} recorded attempts will be permanently deleted. Any active lockouts are lifted, since they are counted from this list.`}
            confirmText="Clear all attempts"
            successText="Sign-in attempts cleared"
          ><Trash2Icon /> Clear all</ConfirmButton>
        ) : null}
      >
        {attempts.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Email</TableHead><TableHead>IP</TableHead><TableHead>Result</TableHead>{canClear ? <TableHead /> : null}</TableRow></TableHeader>
            <TableBody>
              {attempts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(a.created_at)}</TableCell>
                  <TableCell>{a.email_normalized ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.ip}</TableCell>
                  <TableCell><StatusBadge status={a.success ? "paid" : "failed"} /> <span className="ml-1 text-xs text-muted-foreground">{a.reason}</span></TableCell>
                  {canClear ? (
                    <TableCell className="text-right">
                      <ConfirmButton
                        action={deleteLoginAttempt}
                        fields={{ id: a.id }}
                        variant="ghost"
                        size="xs"
                        title="Remove this sign-in attempt?"
                        description={`${a.email_normalized ?? "Unknown email"} from ${a.ip} on ${formatDate(a.created_at)}. If this was a failed attempt it will no longer count towards a lockout.`}
                        confirmText="Remove"
                        successText="Attempt removed"
                        className="text-muted-foreground hover:text-destructive"
                      ><XIcon /><span className="sr-only">Remove</span></ConfirmButton>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4"><TablePagination page={page} perPage={perPage} total={totalAttempts} /></div>
      </Section>
    </div>
  );
}

function shortUa(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}
