"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

export const HERO_CENTER = 50;
const KEY_STEP = 5;
const DRAG_THRESHOLD = 6;
const COVERED = 0.5;

type DragState = {
  id: number;
  startX: number;
  startY: number;
  startSplit: number;
  started: boolean;
  frame: number;
  next: number;
  onHandle: boolean;
};

/** Full-width reveal with pointer, keyboard, resize and unmount handling. */
export function useHeroSplit() {
  const heroRef = useRef<HTMLElement>(null);
  const goRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const split = useRef(HERO_CENTER);
  const drag = useRef<DragState | null>(null);
  const hintAnimation = useRef<Animation | null>(null);
  const [canDrag, setCanDrag] = useState(false);

  const stopHint = useCallback(() => {
    hintAnimation.current?.cancel();
    hintAnimation.current = null;
  }, []);

  const apply = useCallback((value: number) => {
    const hero = heroRef.current;
    if (!hero) return;
    const next = Math.min(100, Math.max(0, value));
    split.current = next;
    if (Math.abs(next - HERO_CENTER) < 0.05) hero.style.removeProperty("--split");
    else hero.style.setProperty("--split", `${next.toFixed(2)}%`);

    goRef.current?.toggleAttribute("inert", next <= COVERED);
    hostRef.current?.toggleAttribute("inert", next >= 100 - COVERED);
    const left = Math.round(next);
    knobRef.current?.setAttribute("aria-valuenow", String(left));
    knobRef.current?.setAttribute(
      "aria-valuetext",
      left === 100 ? "Going out fills the screen" : left === 0 ? "Hosting fills the screen" : `Going out ${left}%, hosting ${100 - left}%`,
    );
  }, []);

  const clearDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active) cancelAnimationFrame(active.frame);
    const hero = heroRef.current;
    if (active && hero?.hasPointerCapture(active.id)) hero.releasePointerCapture(active.id);
    hero?.removeAttribute("data-dragging");
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");
    const sync = () => {
      setCanDrag(media.matches);
      if (!media.matches) {
        clearDrag();
        stopHint();
        apply(HERO_CENTER);
      }
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      media.removeEventListener("change", sync);
      clearDrag();
      stopHint();
    };
  }, [apply, clearDrag, stopHint]);

  useEffect(() => {
    if (canDrag) apply(split.current);
  }, [canDrag, apply]);

  function hint() {
    const hero = heroRef.current;
    if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !hero.animate) return;
    stopHint();
    try {
      hintAnimation.current = hero.animate(
        [{ "--split": "50%" }, { "--split": "55%" }, { "--split": "46.5%" }, { "--split": "50%" }] as Keyframe[],
        { duration: 1300, easing: "cubic-bezier(.45,0,.25,1)" },
      );
    } catch {
      // Unsupported custom-property animation leaves the divider centered.
    }
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!canDrag || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea")) return;
    if (event.pointerType === "mouse") event.preventDefault();
    clearDrag();
    drag.current = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY, startSplit: split.current,
      started: false, frame: 0, next: split.current, onHandle: !!knobRef.current?.contains(target),
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const active = drag.current;
    const hero = heroRef.current;
    if (!active || event.pointerId !== active.id || !hero) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.started) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      if (Math.abs(dy) > Math.abs(dx) && !active.onHandle) {
        clearDrag();
        return;
      }
      active.started = true;
      stopHint();
      hero.setPointerCapture(event.pointerId);
      hero.setAttribute("data-dragging", "");
    }
    active.next = active.startSplit + (dx / hero.clientWidth) * 100;
    active.frame ||= requestAnimationFrame(() => {
      active.frame = 0;
      apply(active.next);
    });
  }

  function endDrag(event: PointerEvent<HTMLElement>, cancelled = false) {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    clearDrag();
    if (active.started) apply(active.next);
    else if (!cancelled && active.onHandle) {
      if (split.current === HERO_CENTER) hint();
      else {
        stopHint();
        apply(HERO_CENTER);
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!canDrag) return;
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": case "ArrowDown": next = split.current - step; break;
      case "ArrowRight": case "ArrowUp": next = split.current + step; break;
      case "Home": next = 0; break;
      case "End": next = 100; break;
      case "Enter": case " ": case "Escape": next = HERO_CENTER; break;
      default: return;
    }
    event.preventDefault();
    clearDrag();
    stopHint();
    apply(next);
  }

  return { heroRef, goRef, hostRef, knobRef, canDrag, onPointerDown, onPointerMove, endDrag, onKeyDown };
}
