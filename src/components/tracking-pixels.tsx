"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Organizer tracking pixels (Phase 2 marketing tools) with cookie consent (plan 11.5).
 * Rendered only on public event pages: never on checkout or payment pages (plan 11.4 / 14.9).
 * Nothing loads until the visitor accepts; the choice is remembered for 180 days.
 */
const COOKIE = "fx_consent";

function readConsent(): "yes" | "no" | null {
  const m = document.cookie.match(/(?:^|; )fx_consent=(yes|no)/);
  return m ? (m[1] as "yes" | "no") : null;
}

function inject(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement("script");
  s.async = true; s.src = src;
  document.head.appendChild(s);
}

type W = Window & { fbq?: ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown; callMethod?: (...a: unknown[]) => void }; _fbq?: unknown; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };

function loadPixels(metaPixelId: string | null, ga4Id: string | null, eventName: string) {
  const w = window as W;
  if (metaPixelId && !w.fbq) {
    const fbq = function (...args: unknown[]) { if (fbq.callMethod) fbq.callMethod(...args); else fbq.queue!.push(args); } as NonNullable<W["fbq"]>;
    fbq.queue = []; fbq.loaded = true; fbq.version = "2.0"; fbq.push = fbq;
    w.fbq = fbq; w._fbq = fbq;
    inject("https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", metaPixelId); fbq("track", "PageView"); fbq("track", "ViewContent", { content_name: eventName });
  }
  if (ga4Id && !w.gtag) {
    w.dataLayer = w.dataLayer || [];
    w.gtag = function (...args: unknown[]) { w.dataLayer!.push(args); };
    w.gtag("js", new Date()); w.gtag("config", ga4Id, { anonymize_ip: true });
    inject(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`);
  }
}

export function TrackingPixels({ metaPixelId, ga4Id, organizer, eventName }: { metaPixelId: string | null; ga4Id: string | null; organizer: string; eventName: string }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!metaPixelId && !ga4Id) return;
    const c = readConsent();
    if (c === "yes") loadPixels(metaPixelId, ga4Id, eventName);
    // Show the banner after mount only (the cookie is not readable on the server render).
    else if (c === null) queueMicrotask(() => setAsk(true));
  }, [metaPixelId, ga4Id, eventName]);
  if (!ask) return null;
  const choose = (v: "yes" | "no") => {
    document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setAsk(false);
    if (v === "yes") loadPixels(metaPixelId, ga4Id, eventName);
  };
  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie consent" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border bg-background p-4 shadow-lg sm:inset-x-6">
      <p className="text-sm">{organizer} would like to measure visits to this event page with {[metaPixelId ? "Meta Pixel" : null, ga4Id ? "Google Analytics" : null].filter(Boolean).join(" and ")}. These are only loaded if you agree, and never on the checkout page.</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => choose("no")}>Decline</Button>
        <Button size="sm" onClick={() => choose("yes")}>Accept</Button>
      </div>
    </div>
  );
}
