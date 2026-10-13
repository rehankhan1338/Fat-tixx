/* Small building blocks for the /create form: sections, labels, inputs, switches and segmented choices. */

import type { ReactNode } from "react";
import { cx } from "@/components/ui/styles";

export const input =
  "w-full min-h-12 rounded-[14px] border border-fx-red/20 bg-white px-4 text-[15px] text-fx-ink outline-none transition-colors placeholder:text-fx-red/55 focus:border-fx-red aria-invalid:border-fx-red-second";

export const labelCls = "block text-[13px] font-semibold text-fx-red/78";

export function Section({
  id,
  title,
  hint,
  icon,
  error,
  children,
  right,
}: {
  id: string;
  title: string;
  hint?: string;
  icon?: ReactNode;
  error?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id + "-h"} className="scroll-mt-28 border-b border-fx-red/12 py-8 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id + "-h"} className="flex items-center gap-[10px] font-display text-[22px] font-semibold tracking-[-0.02em]">
          {icon && <span className="flex text-fx-red-second">{icon}</span>}
          {title}
        </h2>
        {right}
      </div>
      {hint && <p className="mt-1 text-[14px] leading-[1.5] text-fx-red/78">{hint}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-fx-red/[.06] px-3 py-2 text-[14px] font-semibold text-fx-red-second">
          {error}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** a section that starts folded; opens to show its fields */
export function Fold({ id, title, hint, icon, open, onToggle, children }: {
  id: string;
  title: string;
  hint: string;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 rounded-[20px] border border-fx-red/12 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 text-left"
      >
        {icon && <span className="flex text-fx-red-second">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[17px] font-semibold tracking-[-0.01em]">{title}</span>
          {!open && <span className="block truncate text-[13px] text-fx-red/78">{hint}</span>}
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className={cx("shrink-0 transition-transform duration-300", open && "rotate-45")}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && <div className="border-t border-fx-red/10 px-5 pt-4 pb-5">{children}</div>}
    </section>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && <span className="block text-[13px] leading-[1.45] text-fx-red/78">{hint}</span>}
      </span>
      <span className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200", checked ? "bg-fx-red" : "bg-fx-red/20")}>
        <span className={cx("absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(78,7,11,.35)] transition-transform duration-200", checked && "translate-x-5")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "md" | "lg";
}) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex max-w-full flex-wrap gap-1 rounded-full bg-fx-sand p-1", size === "lg" && "w-full flex-nowrap")}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cx(
            "min-h-11 cursor-pointer rounded-full px-5 text-[14px] font-semibold transition-colors duration-200",
            size === "lg" && "flex-1 text-[15px]",
            value === o.v ? "bg-fx-red text-fx-ivory" : "bg-transparent text-fx-red hover:bg-white/60",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-2 text-[13px] font-semibold text-fx-red-second">{children}</p>;
}

/* icons (stroke, 20px) */
const I = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const Icons = {
  calendar: I("M3 5h18v16H3zM3 10h18M8 3v4M16 3v4"),
  pin: I("M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"),
  ticket: I("M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM14 6v12"),
  grid: I("M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"),
  text: I("M4 6h16M4 12h16M4 18h10"),
  image: I("M3 4h18v16H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 20"),
  star: I("M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"),
  video: I("M3 6h13v12H3zM16 10l5-3v10l-5-3"),
  settings: I("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
  shield: I("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"),
};
