"use client";

import { useEffect, useRef, useState } from "react";
import { keepSessionAlive } from "@/lib/auth/keepalive";

/**
 * While the user is active on the page (pointer or keyboard in the last few minutes), ping the server every few minutes
 * so the session's idle timeout counts that activity. Answers false once the server says the session has ended, so the
 * page can tell the user to sign in again before they lose work.
 */
export function useKeepAlive(enabled = true, everyMs = 4 * 60_000): boolean {
  const [alive, setAlive] = useState(true);
  const lastActive = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    lastActive.current = Date.now();
    const mark = () => { lastActive.current = Date.now(); };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const ev of events) window.addEventListener(ev, mark, { passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - lastActive.current > everyMs) return;
      keepSessionAlive().then(setAlive).catch(() => {});
    }, everyMs);
    return () => {
      for (const ev of events) window.removeEventListener(ev, mark);
      window.clearInterval(timer);
    };
  }, [enabled, everyMs]);
  return alive;
}
