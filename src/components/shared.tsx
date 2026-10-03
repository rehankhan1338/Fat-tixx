import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle, EmptyContent } from "@/components/ui/empty";

/* ---------- Page scaffolding ---------- */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Section({ title, description, actions, children, className = "" }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      {title ? (
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/* ---------- Status badges ---------- */
const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  valid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  succeeded: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  draft: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
  logged: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  queued: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  postponed: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  used: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  completed: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  suspended: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  refunded: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  partially_refunded: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  expired: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  failed: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  disabled: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  paused: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  scheduled: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  awaiting_approval: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={`capitalize ${STATUS_STYLES[status] ?? ""}`}>{status.replace(/_/g, " ")}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  const label: Record<string, string> = { super_admin: "Super Admin", support: "Support", finance: "Finance", org_admin: "Org Admin", organizer: "Organizer", staff: "Staff / Scanner" };
  return <Badge variant="secondary">{label[role] ?? role}</Badge>;
}

/* ---------- Formatting ---------- */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
