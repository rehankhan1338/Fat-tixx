"use client";

/*
 * "Host your first event in four steps."
 * A tall track (520vh desktop, 560vh phones, see CSS) with a sticky stage. Scroll progress through the
 * track scrubs the phone screens (slide up/down) and the step text (fade/slide). It holds on each step,
 * then glides to the next over the middle 40% of the gap. Only transforms/opacity are animated.
 * The phone is scaled from the box it sits in (not window height, which jumps on iOS).
 */

import { useEffect, useRef } from "react";
import { cx, eyebrow, sectionTitle } from "@/components/home/styles";
import PhoneScreens from "./PhoneScreens";

const STEPS = [
  { i: 0, side: "l", h: "Create your event.", p: "Add a cover, date, venue and lineup. Save it as a draft and publish when you’re ready." },
  { i: 1, side: "r", h: "Set your tickets.", p: "Early bird, general, VIP or tables. Set prices, limits and promo codes for your crew." },
  { i: 2, side: "l", h: "Share one link.", p: "Post it, text it, put it in your bio. Watch page views and sales come in live." },
  { i: 3, side: "r", h: "Check people in.", p: "Scan tickets at the door with your phone and see who’s arrived in real time." },
];
const DOTS = ["Create", "Tickets", "Share", "Check in"];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => x * x * (3 - 2 * x);

export default function HowItWorks() {
  const trackRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current!;
    const sticky = stickyRef.current!;
    const stage = stageRef.current!;
    const phone = phoneRef.current!;
    const screens = Array.from(track.querySelectorAll<HTMLElement>(".screen"));
    const steps = Array.from(track.querySelectorAll<HTMLElement>(".how-step"));
    const dots = Array.from(dotsRef.current!.querySelectorAll<HTMLButtonElement>("button"));
    const N = screens.length;
    let ticking = false;
    let lastPos = -1;
    let lastDot = -1;

    const sizePhone = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      phone.style.setProperty("--ps", Math.min(1, (h * 0.9) / 640, (w * 0.9) / 300).toFixed(3));
    };

    const progress = () => {
      const r = track.getBoundingClientRect();
      const range = track.offsetHeight - sticky.offsetHeight;
      return range > 0 ? clamp(-r.top / range, 0, 1) : 0;
    };

    const render = () => {
      ticking = false;
      const t = clamp(progress() * N - 0.5, 0, N - 1);
      const i0 = Math.floor(t);
      const pos = i0 + smooth(clamp((t - i0 - 0.3) / 0.4, 0, 1));
      if (Math.abs(pos - lastPos) < 0.0005) return;
      lastPos = pos;
      screens.forEach((el) => {
        const d = Number(el.dataset.i) - pos;
        el.style.transform =
          Math.abs(d) >= 1
            ? `translate3d(0,${d > 0 ? 100 : -100}%,0)`
            : `translate3d(0,${(d * 100).toFixed(2)}%,0) scale(${(1 - Math.abs(d) * 0.06).toFixed(3)})`;
      });
      steps.forEach((el) => {
        const d = Number(el.dataset.i) - pos;
        const o = clamp(1 - Math.abs(d) * 2.2, 0, 1);
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translate3d(0,${(d * 40).toFixed(1)}px,0)`;
        el.style.visibility = o > 0 ? "visible" : "hidden";
      });
      const di = Math.round(pos);
      if (di !== lastDot) {
        lastDot = di;
        dots.forEach((d, k) => d.setAttribute("aria-current", k === di ? "true" : "false"));
      }
    };

    const queue = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(render);
      }
    };
    const onResize = () => {
      sizePhone();
      lastPos = -1;
      queue();
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(sizePhone);
    ro.observe(stage);
    sizePhone();
    render();
    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  function goTo(k: number) {
    const track = trackRef.current!;
    const sticky = stickyRef.current!;
    const top = track.getBoundingClientRect().top + window.pageYOffset;
    const range = track.offsetHeight - sticky.offsetHeight;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: top + range * ((k + 0.5) / DOTS.length), behavior: reduce ? "auto" : "smooth" });
  }

  const side = (s: "l" | "r") =>
    STEPS.filter((st) => st.side === s).map((st) => (
      <div key={st.i} className={"how-step" + (st.i === 0 ? " is-active" : "")} data-i={st.i}>
        <div className="max-w-[360px] max-[901px]:max-w-[440px]">
          <h3 className="font-display text-[clamp(30px,3vw,44px)] leading-[1.02] font-semibold tracking-[-0.035em] max-[901px]:text-[28px]">{st.h}</h3>
          <p className="mt-[14px] text-[17px] leading-[1.6] text-fx-red/78 max-[901px]:mt-2 max-[901px]:text-[15px]">{st.p}</p>
        </div>
      </div>
    ));

  return (
    <section className="how relative bg-fx-ivory" id="how" aria-labelledby="how-h">
      <div className="reveal flex flex-col items-center px-(--pad) pt-[110px] text-center">
        <div className={eyebrow}>For organizers</div>
        <h2 className={cx(sectionTitle, "mt-[14px] text-[clamp(38px,5vw,68px)] leading-none tracking-[-0.04em]")} id="how-h">
          Host your first event
          <br />
          in four steps.
        </h2>
      </div>
      <div className="how-track" ref={trackRef}>
        <div className="how-sticky" ref={stickyRef}>
          <div className="how-stage" ref={stageRef}>
            <div className="how-phone-wrap" ref={phoneRef} aria-hidden="true">
              <div className="how-phone">
                <div className="island" />
                <div className="how-screens">
                  <PhoneScreens />
                </div>
              </div>
            </div>
          </div>
          <div className="how-side l">{side("l")}</div>
          <div className="how-side r">{side("r")}</div>
          <div
            ref={dotsRef}
            aria-label="Steps"
            className="absolute bottom-[14px] left-1/2 z-[6] flex -translate-x-1/2 gap-1 rounded-full border border-fx-red/14 bg-fx-ivory/80 p-1 max-[901px]:hidden"
          >
            {DOTS.map((d, k) => (
              <button
                key={d}
                type="button"
                aria-current={k === 0 ? "true" : "false"}
                onClick={() => goTo(k)}
                className="min-h-[34px] cursor-pointer rounded-full bg-transparent px-[14px] text-[13px] font-medium text-fx-red/78 transition-colors duration-300 aria-[current=true]:bg-fx-red aria-[current=true]:text-fx-ivory"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
