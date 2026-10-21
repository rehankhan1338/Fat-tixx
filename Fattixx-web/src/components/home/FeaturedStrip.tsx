"use client";

/* Repeated tile sets create the loop; refs hold per-frame offsets without React renders. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { clock, DOW, eventHref, isPro, money, MON, organizerName, priceText, whenText } from "@/lib/home/events";
import ProBadge from "@/components/events/ProBadge";
import EventArt from "@/components/ui/EventArt";
import { container, cx } from "@/components/ui/styles";
import { useHome } from "./HomeState";

const SPEED = 32; // drift, pixels per second
const RESUME_MS = 2500; // drift starts again this long after the last manual move
const FRICTION = 4.5; // how quickly a flick slows down (per second)

const infoBtn =
  "inline-flex min-h-[46px] items-center gap-2 rounded-full px-[22px] text-[15px] font-semibold transition-transform duration-[250ms] ease-spring hover:-translate-y-0.5 max-[721px]:min-h-[42px] max-[721px]:px-4 max-[721px]:text-[14px]";

export default function FeaturedStrip() {
  const { featured, reduceMotion } = useHome();
  const secRef = useRef<HTMLElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const infoRef = useRef<HTMLDivElement>(null);

  const [sets, setSets] = useState(2);
  const [active, setActive] = useState<number | null>(null); // index of the open tile in the rendered track

  // animation state kept out of React
  const s = useRef({
    x: 0,
    setW: 0,
    inside: false,
    inView: true,
    drag: null as null | { sx: number; sy: number; x0: number; moved: boolean; id: number; lx: number; lt: number },
    vel: 0, // px/s, momentum after a flick
    suppressClick: false,
    shift: 0, // remaining eased move (arrows, opening a tile)
    resumeAt: 0,
    activeEl: null as HTMLElement | null,
  });

  const paint = () => {
    if (trackRef.current) trackRef.current.style.transform = `translate3d(${s.current.x.toFixed(2)}px,0,0)`;
  };
  const wrapX = () => {
    const st = s.current;
    if (!st.setW) return;
    while (st.x <= -st.setW) st.x += st.setW;
    while (st.x > 0) st.x -= st.setW;
  };
  const hold = () => (s.current.resumeAt = performance.now() + RESUME_MS);

  /* keep the details lined up under the open photo, inside the screen */
  const place = () => {
    const el = s.current.activeEl;
    const view = viewRef.current;
    const info = infoRef.current;
    if (!el || !view || !info) return;
    const r = el.getBoundingClientRect();
    const vr = view.getBoundingClientRect();
    // the details sit in the same column as the strip, so they stay within its edges
    const left = Math.min(Math.max(r.left - vr.left, 0), vr.width - info.offsetWidth);
    info.style.transform = `translateX(${Math.max(0, left).toFixed(1)}px)`;
  };

  const deactivate = useCallback(() => {
    if (!s.current.activeEl) return;
    s.current.activeEl = null;
    setActive(null);
    s.current.resumeAt = performance.now() + RESUME_MS;
  }, []);

  const activate = (el: HTMLElement) => {
    const st = s.current;
    st.activeEl = el;
    st.vel = 0;
    setActive(Number(el.dataset.pos));
    // slide the strip so the opened photo sits fully on screen
    const sec = secRef.current!;
    const r = el.getBoundingClientRect();
    const vr = viewRef.current!.getBoundingClientRect();
    const wOn = parseFloat(getComputedStyle(sec).getPropertyValue("--fw-on")) || r.width;
    st.shift = 0;
    if (r.left + wOn > vr.right) st.shift = vr.right - (r.left + wOn);
    if (r.left + st.shift < vr.left) st.shift = vr.left - r.left;
  };

  /** move by `dir` tiles (arrows / keyboard), eased */
  const step = (dir: number) => {
    const st = s.current;
    const sec = secRef.current;
    if (!sec) return;
    const w = parseFloat(getComputedStyle(sec).getPropertyValue("--fw")) || 224;
    const vw = viewRef.current?.clientWidth ?? document.documentElement.clientWidth;
    const tiles = Math.max(1, Math.floor((vw * 0.6) / (w + 12)));
    deactivate();
    st.vel = 0;
    st.shift += -dir * tiles * (w + 12);
    hold();
  };

  // measure one set of tiles and decide how many copies fill the screen
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !featured.length) return;
    const measure = () => {
      const kids = track.children;
      const first = kids[0] as HTMLElement;
      const last = kids[featured.length - 1] as HTMLElement;
      if (!first || !last) return;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      s.current.setW = last.offsetLeft + last.offsetWidth + gap - first.offsetLeft;
      const need = Math.max(2, Math.ceil(window.innerWidth / s.current.setW) + 2);
      setSets(need);
      wrapX();
      paint();
    };
    measure();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        deactivate();
        measure();
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [featured, deactivate]);

  // animation loop: drift, momentum and eased moves
  useEffect(() => {
    const st = s.current;
    let last = 0;
    let raf = 0;
    const speed = reduceMotion ? 0 : SPEED;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      let moved = false;
      if (!st.drag && Math.abs(st.vel) > 8) {
        st.x += st.vel * dt;
        st.vel *= Math.exp(-FRICTION * dt);
        moved = true;
      } else if (!st.drag) st.vel = 0;
      if (Math.abs(st.shift) > 0.5) {
        const k = st.shift * Math.min(1, dt * 9);
        st.x += k;
        st.shift -= k;
        moved = true;
      }
      const paused = st.inside || st.activeEl || st.drag || !st.inView || document.hidden || now < st.resumeAt || Math.abs(st.vel) > 8;
      if (speed && !paused) {
        st.x -= speed * dt;
        moved = true;
      }
      if (moved) {
        wrapX();
        paint();
      }
      if (st.activeEl) place();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const io = new IntersectionObserver((en) => (st.inView = en[0].isIntersecting));
    if (viewRef.current) io.observe(viewRef.current);
    const onDoc = (e: MouseEvent) => {
      // anywhere except a picture or the details (pictures handle their own clicks) closes the open one
      const t = e.target as HTMLElement | null;
      if (st.activeEl && !t?.closest?.(".ftile, .f-info")) deactivate();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && deactivate();
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);

    // trackpad / Shift + wheel scrolls the strip sideways (needs a non-passive listener to stop the page moving)
    const view = viewRef.current;
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      e.preventDefault();
      deactivate();
      st.vel = 0;
      st.shift = 0;
      st.x -= dx * (e.deltaMode === 1 ? 16 : 1);
      wrapX();
      paint();
      st.resumeAt = performance.now() + RESUME_MS;
    };
    view?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
      view?.removeEventListener("wheel", onWheel);
    };
  }, [reduceMotion, deactivate]);

  // replay the details animation when the event changes
  useEffect(() => {
    const info = infoRef.current;
    if (!info || active === null) return;
    info.classList.remove("fi-swap");
    void info.offsetWidth;
    info.classList.add("fi-swap");
    place();
  }, [active]);

  function endDrag() {
    const st = s.current;
    const d = st.drag;
    if (!d) return;
    if (d.moved) {
      st.suppressClick = true;
      setTimeout(() => (st.suppressClick = false), 0);
      st.vel = Math.max(-2500, Math.min(2500, st.vel));
      if (performance.now() - d.lt > 80) st.vel = 0; // held still before letting go: no flick
      hold();
    }
    st.drag = null;
    viewRef.current?.classList.remove("dragging");
  }

  const n = featured.length;
  const tiles = [];
  for (let k = 0; k < sets * n; k++) {
    const e = featured[k % n];
    const dup = k >= n;
    tiles.push(
      <a
        key={k}
        href={eventHref(e)}
        className={"ftile" + (active === k ? " on" : "")}
        data-pos={k}
        draggable={false}
        aria-hidden={dup || undefined}
        tabIndex={dup ? -1 : undefined}
        aria-label={dup ? undefined : `${e.title}, ${whenText(e.dt)}, ${priceText(e)}`}
      >

        <span className="fimg" aria-hidden="true">
          <EventArt e={e} sizes="(max-width: 720px) 240px, 320px" logoBox="inset-x-[14%] inset-y-[28%]" />
        </span>
      </a>,
    );
  }
  const ae = active === null ? null : featured[active % n];

  return (
    <section
      ref={secRef}
      className={"fstrip group/strip relative bg-fx-ivory pt-16 max-[721px]:pt-12" + (active !== null ? " open" : "")}
      aria-label="Featured events"
      aria-roledescription="carousel"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") s.current.inside = true;
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          s.current.inside = false;
          hold();
        }
      }}
    >
      <div className={container}>
      <div className="relative">
        <div
          className="f-view"
          ref={viewRef}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const st = s.current;
            st.vel = 0;
            st.shift = 0;
            st.drag = { sx: e.clientX, sy: e.clientY, x0: st.x, moved: false, id: e.pointerId, lx: e.clientX, lt: performance.now() };
          }}
          onPointerMove={(e) => {
            const st = s.current;
            const d = st.drag;
            if (!d || e.pointerId !== d.id) return;
            const dx = e.clientX - d.sx;
            if (!d.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - d.sy)) {
              d.moved = true;
              deactivate();
              viewRef.current?.classList.add("dragging");
              try {
                viewRef.current?.setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }
            if (d.moved) {
              const now = performance.now();
              const dt = Math.max(1, now - d.lt) / 1000;
              st.vel = 0.8 * ((e.clientX - d.lx) / dt) + 0.2 * st.vel;
              d.lx = e.clientX;
              d.lt = now;
              st.x = d.x0 + dx;
              wrapX();
              paint();
            }
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              step(e.key === "ArrowRight" ? 1 : -1);
            }
          }}
        >
          <div
            className="f-track"
            ref={trackRef}
            onClickCapture={(e) => {
              const t = (e.target as HTMLElement).closest<HTMLElement>(".ftile");
              if (!t) return;
              if (s.current.suppressClick) {
                e.preventDefault();
                return;
              }
              // first click opens the picture; clicking the open one follows its link to the event page
              if (t !== s.current.activeEl) {
                e.preventDefault();
                activate(t);
              }
            }}
          >
            {tiles}
          </div>
        </div>

        {(["prev", "next"] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            onClick={() => step(dir === "next" ? 1 : -1)}
            aria-label={dir === "next" ? "Scroll featured events forward" : "Scroll featured events back"}
            className={cx(
              "absolute top-[calc(var(--fh)/2)] z-[2] flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/95 text-fx-red shadow-[0_12px_28px_-12px_rgba(78,7,11,.55)] transition-[opacity,transform] duration-300 hover:scale-105 focus-visible:opacity-100",
              "opacity-0 group-hover/strip:opacity-100 [@media(hover:none)]:hidden",
              dir === "prev" ? "left-3" : "right-3",
            )}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={dir === "next" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
            </svg>
          </button>
        ))}
      </div>

      <div className="f-infobox">
        <div className="f-info" ref={infoRef} aria-live="polite">
          {ae && (
            <>
              <span
                className="flex w-[60px] shrink-0 flex-col items-center self-start rounded-xl bg-fx-red pt-[10px] pb-[9px] font-display leading-none text-fx-ivory max-[721px]:w-[52px]"
                aria-hidden="true"
              >
                <small className="text-[12px] font-bold tracking-[.12em] text-fx-yellow">{MON[ae.dt.getMonth()].toUpperCase()}</small>
                <b className="mt-1 text-[28px] font-bold tracking-[-0.02em] max-[721px]:text-[24px]">{ae.dt.getDate()}</b>
              </span>
              {/* "fi-body" is the hook for the stagger animation in styles/effects/featured.css */}
              <div className="fi-body flex min-w-0 flex-col gap-[6px]">
                <span className="flex items-center gap-[6px] text-[12px] font-bold tracking-[.12em] text-fx-red-second uppercase">
                  {organizerName(ae)}
                  {isPro(ae) && <ProBadge size={14} />}
                </span>
                <h3 className="font-display text-[26px] leading-[1.08] font-bold tracking-[-0.025em] max-[721px]:text-[22px]">{ae.title}</h3>
                <p className="text-[15px] leading-[1.5] text-fx-red/78">
                  {DOW[ae.dt.getDay()]}, {MON[ae.dt.getMonth()]} {ae.dt.getDate()} at {clock(ae.dt)}
                  <br />
                  {ae.venue}, {ae.city}
                </p>
                <div className="mt-2 flex flex-wrap gap-[10px]">
                  <a href={eventHref(ae)} className={cx(infoBtn, "bg-fx-red text-fx-ivory")}>
                    Get tickets <em className="text-fx-yellow not-italic">{ae.price == null ? "Free" : "from " + money(ae.price)}</em>
                  </a>
                  <Link href="/events" className={cx(infoBtn, "border border-fx-red/14 bg-white text-fx-red")}>
                    View all
                  </Link>
                  <button type="button" onClick={deactivate} className={cx(infoBtn, "cursor-pointer px-3 text-fx-red/78 hover:text-fx-red")}>
                    Close
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </div>
    </section>
  );
}
