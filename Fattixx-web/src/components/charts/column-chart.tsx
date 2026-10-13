"use client";

import { useState } from "react";

/**
 * Single-series column chart (magnitude over an ordered axis, e.g. tickets per day).
 * One series → no legend; the section title names it. Thin columns with a 2px gap, 4px rounded data
 * ends on the baseline, recessive axis, hover/focus tooltip, and a table for screen readers.
 */
export type ColumnDatum = { label: string; value: number; display?: string };

export function ColumnChart({ data, valueLabel, height = 160, emptyText = "No data yet." }: { data: ColumnDatum[]; valueLabel: string; height?: number; emptyText?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length || data.every((d) => d.value === 0)) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const show = hover ?? peak;
  const d = data[show];
  return (
    <figure className="space-y-2">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{hover === null ? "Peak" : d.label}{hover === null ? ` · ${d.label}` : ""}</span>
        <span className="font-medium text-foreground tabular-nums">{d.display ?? d.value.toLocaleString()} {valueLabel}</span>
      </div>
      <div className="relative flex items-end gap-[2px] border-b border-border" style={{ height }} onMouseLeave={() => setHover(null)} aria-hidden="true">
        {data.map((x, i) => (
          <div key={x.label} className="group relative flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
            <div
              className="w-full rounded-t-[4px] transition-opacity"
              style={{ height: `${Math.max(x.value > 0 ? 2 : 0, (x.value / max) * 100)}%`, background: "#2a78d6", opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>{data[0].label}</span>{data.length > 2 ? <span>{data[Math.floor(data.length / 2)].label}</span> : null}<span>{data[data.length - 1].label}</span>
      </div>
      {/* Screen-reader data. The wrapper carries sr-only: a <table> ignores the 1px height and overflow clip and would stretch the page. */}
      <div className="sr-only">
        <table>
          <caption>{valueLabel}</caption>
          <tbody>{data.map((x) => <tr key={x.label}><th scope="row">{x.label}</th><td>{x.display ?? x.value}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}

/** Horizontal share bars for a short ranked list (ticket types, channels). Value text stays in text ink. */
export function ShareBars({ rows }: { rows: { label: string; value: number; display: string; sub?: string }[] }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-muted-foreground">No data yet.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate">{r.label}{r.sub ? <span className="ml-1 text-xs text-muted-foreground">{r.sub}</span> : null}</span><span className="font-mono tabular-nums">{r.display}</span></div>
          <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, background: "#2a78d6" }} /></div>
        </li>
      ))}
    </ul>
  );
}
