/* Server-rendered pieces of the seat map request pages (organizer and staff). */

import { CheckIcon, FileTextIcon } from "lucide-react";
import { formatDate, StatusBadge } from "@/components/shared";
import { formatCents } from "@/lib/money";
import { uploadUrl } from "@/lib/uploads";
import { ACCESSIBILITY, drawingFor, expandLayout, type SeatMapLayout } from "@/lib/seating/layout";
import { SeatMapCanvas, SeatSwatch, type CanvasSeat } from "./SeatMapCanvas";
import { changeLines, REQUEST_STATUS_LABEL, REQUEST_STEPS, type MapChangeRow, type RequestNoteRow, type SeatMapRequestRow } from "@/lib/seating/queries";

/** A map as buyers will see it, every seat open, with the accessibility marks. */
export function MapPreview({ layout, label }: { layout: SeatMapLayout; label: string }) {
  const seats: CanvasSeat[] = expandLayout(layout).map((s) => ({
    id: s.key, x: s.x, y: s.y, color: "#52525b", look: "open", access: s.access, clickable: false,
    title: [s.label, ACCESSIBILITY.find((a) => a.value === s.access)?.label].filter(Boolean).join(" · "),
  }));
  if (!seats.length && !layout.shapes.length) return <p className="text-sm text-muted-foreground">The map is empty so far.</p>;
  return (
    <div className="grid gap-2">
      <SeatMapCanvas drawing={drawingFor(layout)} seats={seats} label={label} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5"><SeatSwatch look="open" color="#52525b" /> Seat ({seats.length.toLocaleString("en-US")})</li>
        {ACCESSIBILITY.filter((a) => seats.some((s) => s.access === a.value)).map((a) => (
          <li key={a.value} className="flex items-center gap-1.5"><SeatSwatch look="open" color="#52525b" access={a.value} /> {a.label} ({seats.filter((s) => s.access === a.value).length})</li>
        ))}
      </ul>
    </div>
  );
}

/** New → In progress → Awaiting organizer approval → Approved, with the current step highlighted. */
export function RequestSteps({ status }: { status: SeatMapRequestRow["status"] }) {
  if (status === "cancelled") return <StatusBadge status="cancelled" />;
  const at = REQUEST_STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Request progress">
      {REQUEST_STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? "step" : undefined} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i < at ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800" : i === at ? "border-amber-500/50 bg-amber-500/15 font-semibold text-amber-900" : "text-muted-foreground"}`}>
          {i < at ? <CheckIcon className="size-3.5" aria-hidden="true" /> : <span className="tabular-nums">{i + 1}</span>}
          {REQUEST_STATUS_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

export function FeeLine({ r }: { r: Pick<SeatMapRequestRow, "fee_cents" | "fee_status" | "fee_paid_at"> }) {
  if (Number(r.fee_cents) === 0) return <span>No set-up fee</span>;
  return (
    <span>
      Set-up fee {formatCents(Number(r.fee_cents))} · {r.fee_status === "paid" ? `paid${r.fee_paid_at ? ` ${formatDate(r.fee_paid_at)}` : ""}` : r.fee_status === "waived" ? "waived" : <strong className="text-amber-700">unpaid</strong>}
    </span>
  );
}

export function FloorPlan({ r }: { r: Pick<SeatMapRequestRow, "floor_plan_path" | "floor_plan_kind"> }) {
  const url = uploadUrl(r.floor_plan_path);
  if (!url) return <p className="text-sm text-muted-foreground">No floor plan attached.</p>;
  if (r.floor_plan_kind === "pdf") {
    return <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-sm font-medium underline"><FileTextIcon className="size-4" /> Open the floor plan (PDF)</a>;
  }
  return (
    <a href={url} target="_blank" rel="noopener" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded image of unknown size, opened full size on click */}
      <img src={url} alt="Venue floor plan" className="max-h-80 w-auto rounded-lg border object-contain" />
    </a>
  );
}

export function NotesThread({ notes, staffView }: { notes: RequestNoteRow[]; staffView: boolean }) {
  if (!notes.length) return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  return (
    <ol className="space-y-3">
      {notes.map((n) => (
        <li key={n.id} className={n.status_to ? "rounded-2xl border border-dashed p-3" : n.from_staff ? "rounded-2xl border border-fx-yellow bg-fx-yellow/15 p-4" : "rounded-2xl border bg-white p-4"}>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {n.from_staff ? `Fattixx${n.author_name ? ` · ${n.author_name}` : ""}` : n.author_name ?? (staffView ? "Organizer" : "You")} · {formatDate(n.created_at)}
            {n.status_to ? <StatusBadge status={n.status_to} /> : null}
          </p>
          <p className="mt-1 text-sm whitespace-pre-line">{n.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function ChangeLog({ changes }: { changes: MapChangeRow[] }) {
  if (!changes.length) return <p className="text-sm text-muted-foreground">No changes yet.</p>;
  return (
    <ol className="space-y-3">
      {changes.map((c) => {
        const lines = changeLines(c.detail);
        return (
          <li key={c.id} className="rounded-lg border p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.summary}</span><span className="text-xs text-muted-foreground">{c.user_name ?? "System"} · {formatDate(c.created_at)} · {c.action}</span></p>
            {lines.length ? <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
          </li>
        );
      })}
    </ol>
  );
}
