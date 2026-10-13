import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle, EmptyContent } from "@/components/ui/empty";

/* ---------- Page scaffolding, in the Fattixx design language (the Super Admin area restyles these through its own shell) ---------- */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[clamp(28px,3vw,38px)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-fx-red">{title}</h1>
        {description ? <p className="mt-2 max-w-[640px] text-[15px] leading-[1.5] text-fx-red/78">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-fx-red/10 bg-white px-6 py-5 shadow-[0_18px_40px_-30px_rgba(168,18,26,.45)]">
      <p className="text-[12px] font-semibold tracking-[.12em] text-fx-red/78 uppercase">{label}</p>
      <p className="mt-3 font-display text-[clamp(28px,2.6vw,36px)] leading-none font-semibold tracking-[-0.03em] text-fx-red tabular-nums">{value}</p>
      {hint ? <p className="mt-2 text-[13px] leading-[1.45] text-fx-red/78">{hint}</p> : null}
    </div>
  );
}

export function Section({ title, description, actions, children, className = "" }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      {title ? (
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
