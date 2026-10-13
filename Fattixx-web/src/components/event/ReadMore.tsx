"use client";

/*
 * Long text folded to a set height with a fade and a "View more" button (used for "About this event").
 * Nothing is folded when the text already fits. All the text is in the HTML either way.
 */

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

export default function ReadMore({ children, maxHeight = 280 }: { children: ReactNode; maxHeight?: number }) {
  const inner = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const check = () => setLong(el.scrollHeight > maxHeight + 40); // don't fold for a line or two
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);

  const folded = long && !open;

  return (
    <div>
      <div id={id} className="relative overflow-hidden" style={folded ? { maxHeight } : undefined}>
        <div ref={inner}>{children}</div>
        {folded && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-fx-ivory to-fx-ivory/0" />}
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="mt-3 cursor-pointer text-[15px] font-semibold text-fx-red-second underline underline-offset-[3px] hover:text-fx-red"
        >
          {open ? "View less" : "View more"}
        </button>
      )}
    </div>
  );
}
