"use client";

/*
 * Featured strip: a full-width row of event photos drifting left (32 px/s), looping forever.
 *  - Mouse: pointing at a photo pauses the drift, grows that photo and shows its details underneath
 *    (lined up with the photo, kept on screen). Moving along the row switches event; leaving closes.
 *  - Touch: first tap opens a photo, tapping elsewhere closes it. Drag/swipe moves the strip.
 *  - Keyboard: tabbing onto a photo opens it.
 * The loop works by rendering the featured list several times ("sets") and wrapping the x offset.
 * The x offset and per-frame positioning are kept in refs (no re-render per frame).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clock, DOW, imageUrl, money, MON, organizerName, photoKey, priceText, whenText } from "@/lib/home/events";
import { cx } from "@/components/home/styles";
import { useHome } from "./HomeState";

const SPEED = 32; // pixels per second

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
    drag: null as null | { sx: number; sy: number; x0: number; moved: boolean; id: number },
    suppressClick: false,
    shift: 0,
    lockUntil: 0,
    leaveT: 0 as ReturnType<typeof setTimeout> | 0,
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

  /* keep the details lined up under the open photo, inside the screen */
  const place = () => {
    const el = s.current.activeEl;
    const sec = secRef.current;
    const info = infoRef.current;
    if (!el || !sec || !info) return;
    const r = el.getBoundingClientRect();
    const sr = sec.getBoundingClientRect();
    const pad = Math.max(16, Math.min(80, sr.width * 0.055));
    const left = Math.min(Math.max(r.left - sr.left, pad), sr.width - info.offsetWidth - pad);
    info.style.transform = `translateX(${Math.max(pad, left).toFixed(1)}px)`;
  };

  const deactivate = useCallback(() => {
    s.current.activeEl = null;
    setActive(null);
  }, []);

  const activate = (el: HTMLElement) => {
    const st = s.current;
    clearTimeout(st.leaveT);
    if (el === st.activeEl) return;
    st.activeEl = el;
    setActive(Number(el.dataset.pos));
    // slide the strip so the opened photo sits fully on screen
    const sec = secRef.current!;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const wOn = parseFloat(getComputedStyle(sec).getPropertyValue("--fw-on")) || r.width;
    const pad = Math.max(16, Math.min(80, vw * 0.055));
    st.shift = 0;
    if (r.left + wOn > vw - pad) st.shift = vw - pad - (r.left + wOn);
    if (r.left + st.shift < pad) st.shift = pad - r.left;
    if (Math.abs(st.shift) > 1) st.lockUntil = performance.now() + 700;
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
      const need = Math.max(2, Math.ceil(window.innerWidth / s.current.setW) + 1);
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

  // animation loop
  useEffect(() => {
    const st = s.current;
    let last = 0;
    let raf = 0;
    const speed = reduceMotion ? 0 : SPEED;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const paused = st.inside || st.activeEl || st.drag || !st.inView || document.hidden;
      if (speed && !paused) {
        st.x -= speed * dt;
        wrapX();
        paint();
      }
      if (Math.abs(st.shift) > 0.5) {
        const step = st.shift * Math.min(1, dt * 9);
        st.x += step;
        st.shift -= step;
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
      if (st.activeEl && secRef.current && !secRef.current.contains(e.target as Node)) deactivate();
    };
    document.addEventListener("click", onDoc);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("click", onDoc);
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

  const n = featured.length;
  if (!n) return null; // no event with a photo yet: leave the strip out
  const tiles = [];
  for (let k = 0; k < sets * n; k++) {
    const e = featured[k % n];
    const dup = k >= n;
    tiles.push(
      <a
        key={k}
        href={e.href ?? "#events"}
        className={"ftile" + (active === k ? " on" : "")}
        data-pos={k}
        draggable={false}
        aria-hidden={dup || undefined}
        tabIndex={dup ? -1 : undefined}
        aria-label={dup ? undefined : `${e.title}, ${whenText(e.dt)}, ${priceText(e)}`}
      >
        {imageUrl(e)
          ? <span className="fimg" style={{ backgroundImage: `url("${imageUrl(e)}")` }} aria-hidden="true" />
          : <span className={"fimg ph-" + photoKey(e)} aria-hidden="true" />}
      </a>,
    );
  }
  const ae = active === null ? null : featured[active % n];

  return (
    <section
      ref={secRef}
      className={"fstrip relative bg-fx-ivory pt-16 max-[721px]:pt-12" + (active !== null ? " open" : "")}
      aria-label="Featured events"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          s.current.inside = true;
          clearTimeout(s.current.leaveT);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          s.current.inside = false;
          s.current.leaveT = setTimeout(deactivate, 200);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && !s.current.inside) deactivate();
      }}
    >
      <div
        className="f-view"
        ref={viewRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          s.current.drag = { sx: e.clientX, sy: e.clientY, x0: s.current.x, moved: false, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const d = s.current.drag;
          if (!d || e.pointerId !== d.id) return;
          const dx = e.clientX - d.sx;
          if (!d.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - d.sy)) {
            d.moved = true;
            viewRef.current?.classList.add("dragging");
            try {
              viewRef.current?.setPointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }
          if (d.moved) {
            s.current.x = d.x0 + dx;
            wrapX();
            paint();
          }
        }}
        onPointerUp={() => endDrag()}
        onPointerCancel={() => endDrag()}
      >
        <div
          className="f-track"
          ref={trackRef}
          onPointerOver={(e) => {
            if (e.pointerType !== "mouse" || s.current.drag?.moved || performance.now() < s.current.lockUntil) return;
            const t = (e.target as HTMLElement).closest<HTMLElement>(".ftile");
            if (t) activate(t);
          }}
          onFocus={(e) => {
            const t = (e.target as HTMLElement).closest<HTMLElement>(".ftile");
            if (t) activate(t);
          }}
          onClickCapture={(e) => {
            const t = (e.target as HTMLElement).closest<HTMLElement>(".ftile");
            if (!t) return;
            if (s.current.suppressClick) { e.preventDefault(); return; }
            // first tap opens the details; a second tap on the open photo follows its link to the event page
            if (t !== s.current.activeEl || t.getAttribute("href") === "#events") { e.preventDefault(); activate(t); }
          }}
        >
          {tiles}
        </div>
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
                <span className="text-[12px] font-bold tracking-[.12em] text-fx-red-second uppercase">{organizerName(ae)}</span>
                <h3 className="font-display text-[26px] leading-[1.08] font-bold tracking-[-0.025em] max-[721px]:text-[22px]">{ae.title}</h3>
                <p className="text-[15px] leading-[1.5] text-fx-red/78">
                  {DOW[ae.dt.getDay()]}, {MON[ae.dt.getMonth()]} {ae.dt.getDate()} at {clock(ae.dt)}
                  <br />
                  {ae.venue}, {ae.city}
                </p>
                <div className="mt-2 flex flex-wrap gap-[10px]">
                  <a href={ae.href ?? "#events"} className={cx(infoBtn, "bg-fx-red text-fx-ivory")}>
                    Get tickets <em className="text-fx-yellow not-italic">{ae.price == null ? "Free" : "from " + money(ae.price)}</em>
                  </a>
                  <a href="#events" className={cx(infoBtn, "border border-fx-red/14 bg-white text-fx-red")}>
                    View all
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );

  function endDrag() {
    const d = s.current.drag;
    if (!d) return;
    if (d.moved) {
      s.current.suppressClick = true;
      setTimeout(() => (s.current.suppressClick = false), 0);
    }
    s.current.drag = null;
    viewRef.current?.classList.remove("dragging");
  }
}
