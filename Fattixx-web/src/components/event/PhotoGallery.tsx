"use client";

/*
 * The event's photo grid and a full-screen viewer. A photo opens in the viewer instead of a new tab;
 * arrows, the keyboard (← → Esc), swiping and the thumbnail strip move between photos.
 * Each photo is still a link to the file, so a middle-click or a page without JavaScript opens it directly.
 */

import type { PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/styles";
import { ChevronLeft, ChevronRight, CloseIcon } from "./icons";
import { lockScroll } from "./scroll-lock";

const navBtn =
  "grid size-12 cursor-pointer place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition-[background-color,scale] duration-200 hover:bg-white/20 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white max-[641px]:size-11";

export default function PhotoGallery({ photos }: { photos: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLUListElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const count = photos.length;
  const many = count > 1;

  const go = useCallback(
    (to: number) => {
      setIndex((cur) => {
        const next = (to + count) % count;
        if (next !== cur) setLoaded(false);
        return next;
      });
    },
    [count],
  );

  function open(i: number) {
    const d = ref.current;
    if (!d) return;
    setLoaded(false);
    setIndex(i);
    if (!d.open) {
      lockScroll(true);
      d.showModal();
    }
  }

  // arrow keys while the viewer is open (Esc is the dialog's own)
  useEffect(() => {
    const d = ref.current;
    if (!d || !many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else return;
      e.preventDefault();
    };
    d.addEventListener("keydown", onKey);
    return () => d.removeEventListener("keydown", onKey);
  }, [go, index, many]);

  // keep the current thumbnail in view
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  // load the next and previous photos ahead of time so moving between them is instant
  useEffect(() => {
    if (!many || !ref.current?.open) return;
    for (const i of [index + 1, index - 1]) new window.Image().src = photos[(i + count) % count];
  }, [index, many, photos, count]);

  // never leave the page locked if this unmounts while open (e.g. client-side navigation)
  useEffect(() => () => lockScroll(false), []);

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: PointerEvent) {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !many) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) ref.current?.close(); // swipe down to close
  }

  return (
    <>
      <ul className="mt-5 grid grid-cols-3 gap-3 max-[641px]:grid-cols-2">
        {photos.map((src, i) => (
          <li key={src} className={cx("overflow-hidden rounded-[18px] bg-white", i === 0 && count % 2 === 1 && "col-span-2 row-span-2 max-[641px]:col-span-2")}>
            <a
              href={src}
              target="_blank"
              rel="noopener"
              aria-haspopup="dialog"
              aria-label={`View photo ${i + 1} of ${count}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let "open in new tab" work
                e.preventDefault();
                open(i);
              }}
              className="group relative block h-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fx-red"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimized upload */}
              <img src={src} alt={`Photo ${i + 1} of ${count}`} loading="lazy" className="aspect-square h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-fx-red-deep/0 transition-colors duration-300 group-hover:bg-fx-red-deep/10" />
            </a>
          </li>
        ))}
      </ul>

      <dialog
        ref={ref}
        aria-label="Event photos"
        onClose={() => lockScroll(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-white backdrop:bg-[rgb(14,2,3)]/92 backdrop:backdrop-blur-sm open:animate-fade-in open:backdrop:animate-fade-in"
      >
        <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          {/* top bar: counter and close */}
          <div className="flex shrink-0 items-center justify-between px-5 py-4 max-[641px]:px-3 max-[641px]:py-3">
            <p className="rounded-full bg-white/10 px-3 py-1 text-[14px] font-medium tabular-nums backdrop-blur-md" aria-live="polite">
              {index + 1} / {count}
            </p>
            <button type="button" onClick={() => ref.current?.close()} className={navBtn} autoFocus>
              <CloseIcon />
              <span className="sr-only">Close photos</span>
            </button>
          </div>

          {/* the photo; a click on the space around it closes the viewer */}
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-20 select-none max-[641px]:px-0"
            onClick={(e) => {
              if (e.target === e.currentTarget) ref.current?.close();
            }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (swipe.current = null)}
          >
            {!loaded && <span aria-hidden="true" className="absolute size-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />}
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimized upload */}
            <img
              key={photos[index]}
              src={photos[index]}
              alt={`Photo ${index + 1} of ${count}`}
              draggable={false}
              ref={(el) => {
                if (el?.complete && el.naturalWidth) setLoaded(true); // already cached
              }}
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className={cx(
                "max-h-full max-w-full rounded-[14px] object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,.7)] transition-[opacity,scale] duration-300 ease-out max-[641px]:rounded-none",
                loaded ? "scale-100 opacity-100" : "scale-[.98] opacity-0",
              )}
            />

            {many && (
              <>
                <button type="button" onClick={() => go(index - 1)} className={cx(navBtn, "absolute left-5 max-[641px]:left-2 max-[641px]:bg-black/35")}>
                  <ChevronLeft />
                  <span className="sr-only">Previous photo</span>
                </button>
                <button type="button" onClick={() => go(index + 1)} className={cx(navBtn, "absolute right-5 max-[641px]:right-2 max-[641px]:bg-black/35")}>
                  <ChevronRight />
                  <span className="sr-only">Next photo</span>
                </button>
              </>
            )}
          </div>

          {/* thumbnails */}
          {many && (
            <ul ref={strip} className="flex shrink-0 justify-center-safe gap-2 overflow-x-auto px-4 py-4 [scrollbar-width:none] max-[641px]:py-3">
              {photos.map((src, i) => (
                <li key={src} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === index || undefined}
                    className={cx(
                      "block size-16 cursor-pointer overflow-hidden rounded-[10px] ring-2 transition-[opacity,box-shadow] duration-200 max-[641px]:size-12",
                      i === index ? "opacity-100 ring-white" : "opacity-50 ring-transparent hover:opacity-85",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimized upload */}
                    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                    <span className="sr-only">Show photo {i + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  );
}
