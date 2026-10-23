"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/**
 * Cloudflare Turnstile widget (src/lib/security/captcha.ts). Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
 * not set. Inside a <form> the widget adds its own hidden `cf-turnstile-response` field; forms that call a Server
 * Function directly read the token through the ref instead. Tokens are single-use, so the widget is reset after every
 * submit of its form (and by callers through `reset()`).
 */
type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
  getResponse: (id: string) => string | undefined;
};
declare global { interface Window { turnstile?: Turnstile } }

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
    s.onerror = () => { loading = null; reject(new Error("Turnstile did not load")); };
    document.head.appendChild(s);
  });
  return loading;
}

export const captchaOn = !!SITE_KEY;

export type CaptchaHandle = { token: () => string | null; reset: () => void };

export function Captcha({ ref, className = "" }: { ref?: Ref<CaptchaHandle>; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    token: () => (widget.current && window.turnstile?.getResponse(widget.current)) || null,
    reset: () => { if (widget.current) window.turnstile?.reset(widget.current); },
  }), []);

  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    const el = box.current;
    let cancelled = false;
    loadTurnstile().then((t) => {
      if (cancelled || widget.current) return;
      widget.current = t.render(el, { sitekey: SITE_KEY, theme: "light", size: "flexible", action: "fattixx" });
    }).catch(() => { /* the server then answers with a clear message */ });
    // Single-use tokens: after the form is submitted (React has read its fields by then), get a fresh one.
    const form = el.closest("form");
    const onSubmit = () => setTimeout(() => { if (widget.current) window.turnstile?.reset(widget.current); }, 0);
    form?.addEventListener("submit", onSubmit);
    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit);
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={box} className={`min-h-[65px] ${className}`} />;
}
