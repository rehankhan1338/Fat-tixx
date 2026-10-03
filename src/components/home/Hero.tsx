"use client";

/*
 * Hero: "I'm going out / I'm hosting" toggle, 3D ticket that flips between the two sides,
 * orbiting category tickets, white sheet over a red back layer.
 *
 * Behaviour
 *  - Auto-flips every 5 s until the visitor clicks the toggle (paused off-screen / reduced motion).
 *  - Mouse tilts the ticket and shifts the layers (--px / --py), desktop pointer only.
 *  - Scroll parallax: the red layer and big word move slower than the white (--par).
 *  - fitHero(): on desktop widths the split line (--seam) and ticket scale (--ss) follow the
 *    screen height so the whole hero fits short laptop screens.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowIcon } from "./icons";

type Mode = "go" | "host";

const COPY = {
  go: {
    word: "GO OUT",
    h: "Find your next night out.",
    p: "Concerts, parties, workshops and more. Discover what’s on near you and get your tickets on Fattixx.",
    c1: "Browse events",
    c1h: "#events",
    c2: "What’s on this weekend",
    c2h: "#events",
    ring: ["Concerts", "Nightlife", "Comedy", "Food & drink", "Workshops", "Festivals", "Sports", "Arts"],
  },
  host: {
    word: "THROW ONE",
    h: "Sell out your next event.",
    p: "Build your event page, set up ticket tiers, and check guests in at the door, all on Fattixx.",
    c1: "Start hosting",
    c1h: "#host",
    c2: "How it works",
    c2h: "#how",
    ring: ["Ticket tiers", "Promo codes", "Payouts", "QR scanning", "Guest lists", "Early bird", "Insights", "Event pages"],
  },
} as const;

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("go");
  const [swapped, setSwapped] = useState(false); // play the text swap animation after the first change
  const pickedRef = useRef(false);
  const c = COPY[mode];

  function change(m: Mode, picked: boolean) {
    if (picked) pickedRef.current = true;
    setMode(m);
    setSwapped(true);
  }

  // auto-flip every 5 s until the visitor picks a side
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      const hero = heroRef.current;
      if (pickedRef.current || document.hidden || !hero) return;
      if (hero.getBoundingClientRect().bottom < 0) return;
      setMode((m) => (m === "go" ? "host" : "go"));
      setSwapped(true);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // mouse tilt (desktop pointer only)
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          el.style.setProperty("--px", x.toFixed(3));
          el.style.setProperty("--py", y.toFixed(3));
        });
    };
    const leave = () => {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // fit to screen height on desktop widths
  useEffect(() => {
    const hero = heroRef.current;
    const stage = stageRef.current;
    if (!hero || !stage) return;
    const fit = () => {
      const w = document.documentElement.clientWidth;
      if (w <= 900) {
        hero.style.removeProperty("--seam");
        stage.style.removeProperty("--ss");
        stage.style.removeProperty("top");
        return;
      }
      const h = hero.clientHeight;
      const widthScale = w <= 1200 ? 0.85 : 1;
      const ss = Math.max(0.62, Math.min(widthScale, h / 880));
      const seam = Math.round(Math.max(360, Math.min(520, h * 0.53)));
      hero.style.setProperty("--seam", seam + "px");
      stage.style.setProperty("--ss", ss.toFixed(3));
      stage.style.top = seam - 270 + "px";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // scroll parallax for the red layer
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = Math.min(window.pageYOffset, hero.offsetHeight);
        hero.style.setProperty("--par", (y * 0.22).toFixed(1));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const swap = swapped ? " swap" : "";

  return (
    <section ref={heroRef} className={"hero depth edge-curve" + (mode === "host" ? " is-host" : "")} id="hero" aria-label="Fattixx">
      <div className="hback" aria-hidden="true" />
      <div className="hero-word follow" aria-hidden="true">
        {c.word}
      </div>
      <div className="sheet-wrap" aria-hidden="true">
        <div className="sh thick" />
        <div className="sh top" />
      </div>
      <div className="foot-wrap" aria-hidden="true">
        <div className="sh foot" />
      </div>

      <div className="corner left">
        Tickets for everything
        <br />
        DO IT ALL
      </div>

      <div className="toggle" role="group" aria-label="Choose your side">
        <span className="ind" aria-hidden="true" />
        <button type="button" className="t-go" aria-pressed={mode === "go"} onClick={() => change("go", true)}>
          I’m going out
        </button>
        <button type="button" className="t-host" aria-pressed={mode === "host"} onClick={() => change("host", true)}>
          I’m hosting
        </button>
      </div>

      <div className="stage-wrap" ref={stageRef} aria-hidden="true">
        <div className="shadow follow" />
        <div className="stage p3d follow">
          <div className="ring-tilt p3d">
            <div className="ring p3d">
              {c.ring.map((label, i) => (
                <div key={i} className="ring-t" style={{ transform: `rotateY(${i * 45}deg) translateZ(440px)` }}>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bob p3d">
            <div className="flipper p3d">
              <div className="face front">
                <div className="main">
                  <div className="top">
                    <span>ADMIT ONE</span>
                    <span style={{ color: "var(--second)" }}>GUEST PASS</span>
                  </div>
                  <div className="big">
                    GO
                    <br />
                    OUT.
                  </div>
                  <div className="sub">Concerts, parties and workshops</div>
                </div>
                <div className="stub">
                  <span className="stub-no">NO. 000001</span>
                  <span className="barcode" style={{ width: 72, height: 110 }} />
                </div>
                <span className="notch t" />
                <span className="notch b" />
                <span className="sheen" />
              </div>
              <div className="face back">
                <div className="main">
                  <div className="top">
                    <span>ALL ACCESS</span>
                    <span style={{ color: "var(--second)" }}>HOST PASS</span>
                  </div>
                  <div className="big" style={{ color: "var(--dark)" }}>
                    THROW
                    <br />
                    ONE.
                  </div>
                  <div className="sub">Event pages, ticket tiers and payouts</div>
                </div>
                <div className="stub">
                  <span className="stub-no">HOST 0001</span>
                  <span className="barcode" style={{ width: 72, height: 110, color: "var(--dark)" }} />
                </div>
                <span className="notch t" />
                <span className="notch b" />
                <span className="sheen" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* key={mode} remounts the text so the swap animation replays on every change */}
      <div className={"hero-head" + swap} key={"h" + mode}>
        <h1 className="display">{c.h}</h1>
      </div>

      <div className={"hero-copy" + swap} key={"p" + mode}>
        <p>{c.p}</p>
      </div>

      <div className={"hero-cta" + swap} key={"c" + mode}>
        <a href={c.c2h} className="link">
          {c.c2}
        </a>
        <a href={c.c1h} className="btn cta-primary">
          <span>{c.c1}</span>
          <ArrowIcon />
        </a>
      </div>
    </section>
  );
}
