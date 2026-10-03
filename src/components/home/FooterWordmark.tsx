"use client";

/*
 * The big faded FATTIXX wordmark in the footer. On desktop it tilts toward the mouse
 * (sets --px / --py on the footer while the pointer is over it).
 */

import { useEffect, useRef } from "react";

export default function FooterWordmark() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const footer = ref.current?.closest("footer");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!footer || !fine || reduce) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = footer.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width - 0.5) * 2;
      py = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          footer.style.setProperty("--px", px.toFixed(3));
          footer.style.setProperty("--py", py.toFixed(3));
        });
    };
    const leave = () => {
      footer.style.setProperty("--px", "0");
      footer.style.setProperty("--py", "0");
    };
    footer.addEventListener("pointermove", move);
    footer.addEventListener("pointerleave", leave);
    return () => {
      footer.removeEventListener("pointermove", move);
      footer.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="max-w-full [perspective:1200px]" aria-hidden="true">
      <div
        className="bg-[linear-gradient(180deg,rgba(245,241,234,.16),rgba(245,241,234,.02)_85%)] bg-clip-text text-center font-display text-[clamp(72px,18vw,260px)] leading-[.85] font-bold tracking-[-0.05em] whitespace-nowrap text-transparent transition-transform duration-[600ms] ease-fx select-none"
        style={{ transform: "rotateX(calc(14deg + var(--py, 0) * -10deg)) rotateY(calc(var(--px, 0) * 12deg))" }}
      >
        FATTIXX
      </div>
    </div>
  );
}
