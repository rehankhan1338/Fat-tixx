"use client";

/*
 * The event description (plan 5.6): bold, italics, links and bullet lists from a small toolbar, with a preview that
 * looks like the event page. The text keeps light marks (**bold**, *italics*, [link](https://…), "- " bullets) that
 * src/lib/rich-text.ts turns into formatting; plain descriptions written before read the same as ever.
 */

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { RichText } from "@/components/rich-text";
import { safeHref } from "@/lib/rich-text";
import { cx } from "@/components/ui/styles";
import { input, labelCls, Segmented } from "./ui";

const MAX = 20000;

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()} // keep the text selected
      onClick={onClick}
      className="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-[10px] px-2 text-[15px] text-fx-red hover:bg-fx-sand"
    >
      {children}
    </button>
  );
}

export default function DescriptionEditor({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<"write" | "preview">("write");
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkErr, setLinkErr] = useState("");

  /** replace the selection with `before + selected + after`, keeping the selection on the text */
  function wrap(before: string, after: string, placeholder: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    onChange(next.slice(0, MAX));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  }

  /** start each selected line (or the current one) with "- " */
  function bullets() {
    const el = ref.current;
    if (!el) return;
    const lineStart = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const nextBreak = value.indexOf("\n", el.selectionEnd);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const all = lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim());
    const changed = lines.map((l) => (all ? l.replace(/^\s*[-*•]\s+/, "") : l.trim() ? `- ${l.replace(/^\s*[-*•]\s+/, "")}` : l)).join("\n");
    onChange((value.slice(0, lineStart) + changed + value.slice(lineEnd)).slice(0, MAX));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + changed.length);
    });
  }

  function addLink() {
    const href = safeHref(/^[a-z]+:/i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
    if (!href) return setLinkErr("Enter a web address, e.g. https://example.com");
    setLinkErr("");
    setLinkOpen(false);
    setLink("");
    wrap("[", `](${href})`, "link text");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className={labelCls}>
          Description
        </label>
        <Segmented
          label="Description view"
          value={view}
          onChange={setView}
          options={[
            { v: "write", label: "Write" },
            { v: "preview", label: "Preview" },
          ]}
        />
      </div>
      {view === "write" ? (
        <div className="mt-2 rounded-[14px] border border-fx-red/20 bg-white focus-within:border-fx-red">
          <div role="toolbar" aria-label="Formatting" aria-controls={id} className="flex flex-wrap items-center gap-1 border-b border-fx-red/10 p-1">
            <Tool label="Bold" onClick={() => wrap("**", "**", "bold text")}>
              <b>B</b>
            </Tool>
            <Tool label="Italic" onClick={() => wrap("*", "*", "italic text")}>
              <i className="font-serif">I</i>
            </Tool>
            <Tool label="Link" onClick={() => setLinkOpen((o) => !o)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
              </svg>
            </Tool>
            <Tool label="Bullet list" onClick={bullets}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
              </svg>
            </Tool>
          </div>
          {linkOpen && (
            <div className="flex flex-wrap items-start gap-2 border-b border-fx-red/10 p-2">
              <label htmlFor={id + "-link"} className="sr-only">
                Link address
              </label>
              <input
                id={id + "-link"}
                type="url"
                inputMode="url"
                placeholder="https://"
                className={cx(input, "min-h-10 flex-1")}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                autoFocus
              />
              <button type="button" onClick={addLink} className="min-h-10 cursor-pointer rounded-full bg-fx-red px-4 text-[14px] font-semibold text-fx-ivory">
                Add link
              </button>
              {linkErr && <p className="m-0 basis-full text-[13px] font-semibold text-fx-red-second">{linkErr}</p>}
            </div>
          )}
          <textarea
            id={id}
            ref={ref}
            rows={8}
            maxLength={MAX}
            className="block min-h-48 w-full resize-y rounded-b-[14px] border-0 bg-transparent px-4 py-3 text-[15px] leading-[1.55] text-fx-ink outline-none placeholder:text-fx-red/55"
            placeholder="Lineup, dress code, parking, what’s included…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      ) : (
        <div className="mt-2 min-h-48 rounded-[14px] border border-fx-red/20 bg-fx-ivory px-4 py-3">
          {value.trim() ? (
            <RichText text={value} className="grid gap-3 text-[15px] leading-[1.65] text-fx-red/85" />
          ) : (
            <p className="m-0 text-[14px] text-fx-red/78">Nothing to preview yet.</p>
          )}
        </div>
      )}
      <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Select text and use the buttons to format it. Leave a blank line between paragraphs.</p>
    </div>
  );
}
