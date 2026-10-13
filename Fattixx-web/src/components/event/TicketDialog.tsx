"use client";

/* Native dialog opened by the fixed ticket button or #tickets; hides the button over the footer. */

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/styles";
import { CloseIcon } from "./icons";
import { useEventEnded } from "./useEventEnded";

/** stop the page behind the pop-up from scrolling, without the layout shifting when the scrollbar goes away */
function lockScroll(lock: boolean) {
  const root = document.documentElement;
  if (lock) {
    root.style.paddingRight = `${window.innerWidth - root.clientWidth}px`;
    root.style.overflow = "hidden";
  } else {
    root.style.paddingRight = "";
    root.style.overflow = "";
  }
}

export default function TicketDialog({ pillText, endIso, summary, children }: { pillText: string; endIso: string; summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ended = useEventEnded(endIso);
  const [footerInView, setFooterInView] = useState(false);

  const open = useCallback(() => {
    const d = ref.current;
    if (!d || d.open) return;
    lockScroll(true);
    d.showModal();
    d.scrollTop = 0;
    d.querySelector<HTMLElement>("#tickets-h")?.focus();
  }, []);

  // #tickets in the address opens the pop-up, on load and when a link changes it
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#tickets") open();
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [open]);

  // hide the pill over the footer
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const io = new IntersectionObserver(([entry]) => setFooterInView(entry.isIntersecting));
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  // never leave the page locked if this unmounts while open (e.g. client-side navigation)
  useEffect(() => () => lockScroll(false), []);

  function onClose() {
    lockScroll(false);
    // drop #tickets so the same link opens it again
    if (window.location.hash === "#tickets") history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  return (
    <>
      <div
        aria-hidden={footerInView || undefined}
        className={cx(
          "fixed inset-x-0 bottom-0 z-[55] flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] transition-[translate,opacity] duration-300 ease-fx",
          footerInView ? "pointer-events-none translate-y-6 opacity-0" : "pointer-events-none",
        )}
      >
        <button
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          tabIndex={footerInView ? -1 : undefined}
          className="pointer-events-auto inline-flex min-h-[58px] w-full max-w-[520px] cursor-pointer items-center justify-center rounded-full bg-fx-red px-8 font-display text-[18px] font-semibold tracking-[-0.01em] text-fx-ivory shadow-[0_24px_50px_-16px_rgba(78,7,11,.6)] transition-[background-color,scale] duration-200 hover:bg-fx-red-dark active:scale-[.99] max-[641px]:min-h-[54px] max-[641px]:text-[17px]"
        >
          {ended ? "This event has ended" : pillText}
        </button>
      </div>

      <dialog
        ref={ref}
        aria-labelledby="tickets-h"
        onClose={onClose}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close(); // a click on the backdrop
        }}
        className="m-auto max-h-[calc(100dvh-48px)] w-[min(940px,calc(100%-48px))] max-w-none overflow-y-auto overscroll-contain rounded-[28px] bg-fx-ivory p-0 text-fx-red shadow-[0_40px_90px_-30px_rgba(40,2,5,.65)] backdrop:bg-fx-red-deep/55 backdrop:backdrop-blur-[3px] open:animate-pop-in open:backdrop:animate-fade-in max-[721px]:mb-0 max-[721px]:max-h-[92dvh] max-[721px]:w-full max-[721px]:rounded-b-none max-[721px]:open:animate-sheet-in"
      >
        <div id="tickets" className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-8 p-8 max-[721px]:grid-cols-1 max-[721px]:gap-5 max-[721px]:p-5 max-[721px]:pb-[max(20px,env(safe-area-inset-bottom))]">
          <div className="sticky top-8 max-[721px]:static max-[721px]:pr-12">{summary}</div>
          <div className="min-w-0">{children}</div>
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="absolute top-[30px] right-[30px] grid size-11 cursor-pointer place-items-center rounded-full border border-fx-red/15 bg-white text-fx-red transition-colors hover:border-fx-red max-[721px]:top-4 max-[721px]:right-4"
        >
          <CloseIcon />
          <span className="sr-only">Close tickets</span>
        </button>
      </dialog>
    </>
  );
}
