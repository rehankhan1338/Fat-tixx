"use client";

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { cx } from "@/components/ui/styles";

export default function LegalToc({ toc }: { toc: { id: string; text: string }[] }) {
  const [current, setCurrent] = useState(toc[0]?.id ?? "");

  useEffect(() => {
    const els = toc.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => !!e);
    const pick = () => {
      // the last heading that has passed the top third of the screen
      const line = window.innerHeight * 0.33;
      let id = els[0]?.id ?? "";
      for (const el of els) if (el.getBoundingClientRect().top <= line) id = el.id;
      setCurrent(id);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [toc]);

  // closes the phone-sized "Jump to a section" fold after a pick
  function closeFold(e: MouseEvent<HTMLAnchorElement>) {
    e.currentTarget.closest("details")?.removeAttribute("open");
  }

  const list = (onPick?: (e: MouseEvent<HTMLAnchorElement>) => void) => (
    <ol className="flex flex-col gap-0.5">
      {toc.map((t) => (
        <li key={t.id}>
          <a
            href={`#${t.id}`}
            onClick={onPick}
            aria-current={current === t.id ? "location" : undefined}
            className={cx(
              "block rounded-lg py-1.5 pr-2 pl-3 text-[14px] leading-[1.35] transition-colors",
              current === t.id ? "bg-fx-red/[.05] font-semibold text-fx-red" : "text-fx-red/78 hover:text-fx-red",
            )}
          >
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <nav aria-label="On this page" className="sticky top-[104px] max-h-[calc(100dvh-128px)] overflow-y-auto pb-4 [scrollbar-width:thin] max-[901px]:hidden print:hidden">
        <div className="mb-3 pl-3 text-[12px] font-semibold tracking-[.14em] text-fx-red/78 uppercase">On this page</div>
        {list()}
      </nav>
      <details className="group rounded-2xl bg-white ring-1 ring-fx-red/12 min-[901px]:hidden print:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-[15px] font-semibold text-fx-red [&::-webkit-details-marker]:hidden">
          Jump to a section
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open:rotate-180" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <nav aria-label="On this page" className="px-2 pb-3">
          {list(closeFold)}
        </nav>
      </details>
    </>
  );
}
