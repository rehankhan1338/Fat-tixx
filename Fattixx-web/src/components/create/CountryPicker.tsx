"use client";

/* The calling-code picker beside the phone number in the sign-up window: a button that opens a searchable list
 * (search by country name, ISO code or calling code, e.g. "pak", "PK", "92" or "+92"). */

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/styles";
import { COUNTRIES, flag, type Country } from "@/lib/home/countries";
import { input } from "./ui";

export function CountryPicker({ id, value, onChange }: { id: string; value: Country; onChange: (c: Country) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q || c.dial.startsWith(q));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (c: Country) => {
    onChange(c);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country: ${value.name} +${value.dial}`}
        className={cx(input, "flex cursor-pointer items-center gap-2 px-3 text-left")}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{flag(value.code)}</span>
        <span className="flex-1">+{value.dial}</span>
        <span aria-hidden="true" className="text-[11px] text-fx-red/55">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-[min(300px,80vw)] rounded-[14px] border border-fx-red/20 bg-white p-2 shadow-lg">
          <input
            ref={searchRef}
            type="search"
            aria-label="Search country or code"
            placeholder="Search country or code"
            className={cx(input, "min-h-10 px-3 text-[14px]")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[active]) pick(results[active]);
              } else if (e.key === "Escape") {
                // keep the sign-up dialog open; only close the list
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
          <ul ref={listRef} role="listbox" aria-label="Countries" className="mt-2 max-h-56 list-none overflow-y-auto p-0 m-0">
            {results.map((c, i) => (
              <li
                key={c.code}
                role="option"
                aria-selected={c.code === value.code}
                className={cx("flex cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2 text-[14px] text-fx-ink", i === active && "bg-fx-red/8", c.code === value.code && "font-semibold")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
              >
                <span>{flag(c.code)}</span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-fx-red/78">+{c.dial}</span>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-2 text-[14px] text-fx-red/78">No matching country</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
