"use client";

/* Shared bits of the Website forms: repeatable rows (steps, FAQ, links…), a section heading with a show/hide switch, and the token legend. */

import { useState, type ReactNode } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TOKENS } from "@/lib/site-content/schema";

let seq = 0;
const key = () => `r${++seq}`;

/**
 * A list the admin can add to and remove from. Inputs inside use `defaultValue`, so rows keep a stable key: React keeps
 * their DOM nodes (and what was typed) when another row is removed.
 */
export function Rows<T>({ items, max, blank, label, render }: { items: T[]; max: number; blank: T; label: string; render: (item: T, index: number) => ReactNode }) {
  const [rows, setRows] = useState(() => items.map((item) => ({ k: key(), item })));
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.k} className="relative rounded-lg border p-3 pr-12">
          {render(r.item, i)}
          {rows.length > 1 && (
            <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2" aria-label={`Remove ${label} ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))}>
              <Trash2Icon />
            </Button>
          )}
        </div>
      ))}
      {rows.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { k: key(), item: blank }])}>
          <PlusIcon /> Add {label}
        </Button>
      )}
    </div>
  );
}

/** Section heading with a "shown on the page" switch (submits "1" when checked). */
export function SectionHead({ title, description, name, show }: { title: string; description?: string; name?: string; show?: boolean }) {
  return (
    <>
      <Separator />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {name ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name={name} value="1" defaultChecked={show} className="size-4 accent-[var(--primary)]" />
            Shown on the page
          </label>
        ) : null}
      </div>
    </>
  );
}

export function TokenHelp() {
  return (
    <details className="rounded-lg border bg-muted/40 p-3 text-xs">
      <summary className="cursor-pointer font-medium">Placeholders you can type into any text</summary>
      <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {TOKENS.map((t) => (
          <div key={t.token} className="contents">
            <dt><code>{t.token}</code></dt>
            <dd className="text-muted-foreground">{t.meaning}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-muted-foreground">Headings break lines where you press Enter. In paragraphs, [link text](/path) becomes a link.</p>
    </details>
  );
}
