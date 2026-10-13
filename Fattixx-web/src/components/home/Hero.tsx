"use client";

import Image from "next/image";
import Link from "next/link";
import goOutImage from "../../../public/images/hero/go-out.webp";
import throwOneImage from "../../../public/images/hero/throw-one.webp";
import type { HomeContent } from "@/lib/site-content/schema";
import { Lines } from "@/lib/site-content/inline";
import { ArrowIcon } from "./icons";
import { HERO_CENTER, useHeroSplit } from "./useHeroSplit";
import s from "./Hero.module.css";

// Tall mobile panels cover-crop a wide photo, so request enough pixels for that crop.
const PHOTO_SIZES = "(max-width: 900px) 1100px, 100vw";

/** A hero photo: the one uploaded in Super Admin → Website, or the design's default (which has a blur placeholder). */
function Photo({ src, fallback }: { src: string | null; fallback: typeof goOutImage }) {
  return src ? (
    <Image src={src} alt="" fill preload quality={85} sizes={PHOTO_SIZES} className={s.scene} />
  ) : (
    <Image src={fallback} alt="" fill preload quality={85} placeholder="blur" sizes={PHOTO_SIZES} className={s.scene} />
  );
}

/** Two aligned photo layers; navigation is supplied by the existing page. Copy and photos come from Super Admin → Website. */
export default function Hero({ content: c }: { content: HomeContent["hero"] }) {
  const { heroRef, goRef, hostRef, knobRef, canDrag, onPointerDown, onPointerMove, endDrag, onKeyDown } = useHeroSplit();

  return (
    <section
      ref={heroRef}
      id="hero"
      aria-labelledby="hero-h"
      className={s.hero}
      data-draggable={canDrag ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e, true)}
      onLostPointerCapture={(e) => {
        // only our own capture ending counts: on touch, the browser's implicit capture on the touched child is
        // released (and bubbles up here) the moment the hero takes over the pointer
        if (e.target === e.currentTarget) endDrag(e, true);
      }}
    >
      <h1 id="hero-h" className="sr-only">
        {c.heading}
      </h1>

      <div ref={goRef} id="door-go" className={`${s.door} ${s.go}`}>
        <div className={s.bg} aria-hidden="true">
          <Photo src={c.go.image} fallback={goOutImage} />
        </div>
        <div className={s.body}>
          <h2 className={s.word}>
            <Lines text={c.go.word} />
          </h2>
          <p className={s.lead}>{c.go.lead}</p>
        </div>
        <Link href={c.go.cta.href} className={s.cta}>
          {c.go.cta.label} <ArrowIcon />
        </Link>
      </div>

      <div ref={hostRef} id="door-host" className={`${s.door} ${s.host}`}>
        <div className={s.bg} aria-hidden="true">
          <Photo src={c.host.image} fallback={throwOneImage} />
        </div>
        <div className={s.body}>
          <h2 className={s.word}>
            <Lines text={c.host.word} />
          </h2>
          <p className={s.lead}>{c.host.lead}</p>
        </div>
        <Link href={c.host.cta.href} className={s.cta}>
          {c.host.cta.label} <ArrowIcon />
        </Link>
      </div>

      <div className={s.tear}>
        <span className={s.line} aria-hidden="true" />
        {canDrag ? (
          <div
            ref={knobRef}
            className={s.or}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-controls="door-go door-host"
            aria-label="Slide between going out and hosting"
            aria-describedby="hero-slide-hint"
            aria-valuenow={HERO_CENTER}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext="Going out 50%, hosting 50%"
            onKeyDown={onKeyDown}
          >
            <Chevron className={`${s.chev} ${s.chevL}`} dir="left" />
            or
            <Chevron className={`${s.chev} ${s.chevR}`} dir="right" />
          </div>
        ) : (
          <span className={s.or} aria-hidden="true">
            or
          </span>
        )}
      </div>

      {canDrag && (
        <p id="hero-slide-hint" className={s.slideHint}>
          {c.hint}
          <span>{c.hintSub}</span>
        </p>
      )}
      <div className={s.edge} aria-hidden="true" />
    </section>
  );
}

function Chevron({ className, dir }: { className: string; dir: "left" | "right" }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M7.5 2.5 4 6l3.5 3.5" : "M4.5 2.5 8 6l-3.5 3.5"} />
    </svg>
  );
}
