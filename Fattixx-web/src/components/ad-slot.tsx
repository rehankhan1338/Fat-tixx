"use client";

import { useEffect, useRef, useState } from "react";

type Ad = { token: string; clickUrl: string; imageUrl: string | null; alt: string; headline: string | null; body: string | null; advertiser: string | null; kind: string };

/**
 * A named ad placement (plan 14.4). Requests its ad only after the page has rendered, so it can never
 * delay event pages, tickets or check-in; renders nothing (no empty gap) when no ad is active; and counts an
 * impression only once at least half of the ad has been on screen. First-party image + link only, no scripts.
 */
export function AdSlot({ placement, eventId, className = "" }: { placement: string; eventId?: number; className?: string }) {
  const [ad, setAd] = useState<Ad | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ placement, ...(eventId ? { event: String(eventId) } : {}) });
    const load = () => fetch(`/api/ads?${qs}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.status === 200 ? r.json() : null)).then((a: Ad | null) => setAd(a)).catch(() => {});
    // Wait until the browser is idle so ads never compete with the page's own content.
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const h = ric ? ric(load) : window.setTimeout(load, 300);
    return () => { ctrl.abort(); if (!ric) window.clearTimeout(h); };
  }, [placement, eventId]);

  useEffect(() => {
    const el = ref.current;
    if (!ad || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio >= 0.5)) {
        io.disconnect();
        const body = new Blob([ad.token], { type: "text/plain" });
        if (!navigator.sendBeacon?.("/api/ads/impression", body)) void fetch("/api/ads/impression", { method: "POST", body: ad.token, keepalive: true }).catch(() => {});
      }
    }, { threshold: [0.5] });
    io.observe(el);
    return () => io.disconnect();
  }, [ad]);

  if (!ad) return null;
  return (
    <aside ref={ref} aria-label="Sponsored" className={`overflow-hidden rounded-xl border border-dashed bg-muted/30 ${className}`}>
      <p className="px-3 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sponsored{ad.advertiser ? ` · ${ad.advertiser}` : ""}</p>
      <a href={ad.clickUrl} target="_blank" rel="sponsored noopener" className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        {ad.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-optimized WebP from the uploads route
          <img src={ad.imageUrl} alt={ad.alt} loading="lazy" decoding="async" className="max-h-40 w-full rounded-lg object-cover sm:w-64" />
        ) : null}
        {ad.headline || ad.body ? (
          <span className="min-w-0">
            {ad.headline ? <span className="block font-semibold">{ad.headline}</span> : null}
            {ad.body ? <span className="block text-sm text-muted-foreground">{ad.body}</span> : null}
          </span>
        ) : null}
      </a>
    </aside>
  );
}
