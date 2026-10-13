"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/styles";

export const pillBtn =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-5 text-[15px] font-semibold whitespace-nowrap transition-colors duration-200";

export function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export const optionBtn =
  "flex w-full min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 text-left text-[15px] text-fx-red hover:bg-fx-ivory aria-pressed:font-semibold";

export default function FilterMenu({
  label,
  active,
  icon,
  align = "left",
  width = 240,
  children,
}: {
  label: string;
  active: boolean;
  icon?: ReactNode;
  align?: "left" | "right";
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          pillBtn,
          active ? "border-fx-red bg-fx-red text-fx-ivory" : "border-fx-red/30 bg-white text-fx-red hover:border-fx-red",
        )}
      >
        {icon}
        {label}
        <Chevron />
      </button>
      {open && (
        <div
          className={cx(
            "absolute top-[calc(100%+8px)] z-30 max-w-[calc(100vw-32px)] rounded-[18px] bg-white p-2 text-fx-red shadow-[0_24px_50px_-20px_rgba(78,7,11,.55),0_0_0_1px_rgba(168,18,26,.08)]",
            align === "right" ? "right-0" : "left-0",
          )}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
