"use client";

/* Shown once the event is saved: the live link (or the draft notice), share buttons and the way to the dashboard. */

import { useState } from "react";
import { button, cx } from "@/components/ui/styles";
import { toLocal } from "@/lib/home/create";
import type { EventDraft } from "@/lib/home/create";
import { whenText } from "@/lib/home/events";
import { storyImage } from "@/lib/home/story-image";

export type Created = { url: string; manageUrl: string; editUrl: string; published: boolean; verified: boolean; payoutsNeeded: boolean; orgName: string; orgSlug: string; dashboardUrl: string };

/**
 * Instagram has no web link for posting a Story. On phones the picture goes to the share sheet, where Instagram offers
 * "Story"; elsewhere it is downloaded. The event link is copied either way, for Instagram's link sticker.
 */
function InstagramStoryButton({ d, url, when, where }: { d: EventDraft; url: string; when: string; where: string }) {
  const [state, setState] = useState<"idle" | "busy" | "shared" | "downloaded" | "error">("idle");
  async function share() {
    setState("busy");
    try {
      const blob = await storyImage({ cover: d.cover, name: d.name, when, where, url });
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      const file = new File([blob], "fattixx-story.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: d.name });
          setState("shared");
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return setState("idle");
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fattixx-story.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setState("downloaded");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="w-full">
      <button type="button" onClick={share} disabled={state === "busy"} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold text-fx-red hover:border-fx-red disabled:opacity-60">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
        {state === "busy" ? "Making your Story…" : "Instagram Story"}
      </button>
      <p className="mt-2 mb-0 text-[13px] leading-[1.5] text-fx-red/78" aria-live="polite">
        {state === "shared" && "Pick Instagram, then Story. Your event link is copied: add it with the Link sticker."}
        {state === "downloaded" && "Story picture saved. Post it as a Story from Instagram on your phone, and add your event link (copied) with the Link sticker."}
        {state === "error" && "We couldn’t make the picture in this browser. Share the link instead."}
      </p>
    </div>
  );
}

export default function Confirmation({ d, created, onAnother }: { d: EventDraft; created: Created; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  const { url, published } = created;
  const start = toLocal(d.startDate, d.startTime);
  const where = d.location.kind === "online" ? "Online" : d.location.kind === "saved" ? d.location.venueName : d.location.venueName || d.location.address || d.location.city;
  const text = encodeURIComponent(`${d.name}: get your tickets on Fattixx`);
  const u = encodeURIComponent(url);
  const share = [
    { label: "Text message", href: `sms:?&body=${text}%20${u}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${text}%20${u}` },
    { label: "X", href: `https://x.com/intent/post?text=${text}&url=${u}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { label: "Email", href: `mailto:?subject=${encodeURIComponent(d.name)}&body=${text}%0A${u}` },
  ];

  return (
    <div className="mx-auto grid max-w-[980px] grid-cols-[minmax(0,320px)_minmax(0,1fr)] items-start gap-12 px-(--pad) pt-12 pb-24 max-[901px]:grid-cols-1 max-[901px]:gap-8">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-white shadow-[0_30px_60px_-35px_rgba(78,7,11,.6)] max-[901px]:max-w-[280px]">
        {d.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- in-browser preview of the uploaded cover
          <img src={d.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="poster pv1 absolute inset-0 after:hidden" />
        )}
      </div>
      <div>
        <div className="inline-flex items-center gap-2 rounded-full bg-fx-yellow px-3 py-1 text-[13px] font-bold text-fx-red">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
          {published ? (d.visibility === "public" ? "Live on Fattixx" : d.visibility === "private" ? "Live, private link" : "Live, link only") : "Saved as a draft"}
        </div>
        <h1 className="mt-4 font-display text-[clamp(36px,4.6vw,56px)] leading-[.98] font-semibold tracking-[-0.045em]">{published ? "Your event is live." : "Your event is saved."}</h1>
        <p className="mt-3 text-[17px] leading-[1.55] text-fx-red/78">
          <b className="text-fx-red">{d.name}</b>
          <br />
          {start ? whenText(start) : ""}
          {where ? `, ${where}` : ""}
        </p>

        {!published && (
          <div className="mt-6 rounded-[18px] border border-fx-red/14 bg-white p-4">
            <b className="block text-[15px]">Nothing is on sale yet.</b>
            <span className="mt-1 block text-[14px] leading-[1.5] text-fx-red/78">Add anything else you need in the dashboard (add-ons, promo codes, checkout questions), then publish the event when you are ready to sell.</span>
          </div>
        )}

        {created.payoutsNeeded && (
          <div role="status" className="mt-6 rounded-[18px] bg-fx-yellow p-4">
            <b className="block text-[15px]">Set up payouts to get paid for your ticket sales.</b>
            <span className="mt-1 block text-[14px] leading-[1.5] text-fx-red/78">Your tickets can sell now. We hold your earnings until your bank details and identity check are done.</span>
            <a href={`/org/${created.orgSlug}/payouts`} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
              Set up payouts
            </a>
          </div>
        )}

        <div className="mt-6">
          <label htmlFor="event-url" className="block text-[13px] font-semibold text-fx-red/78">
            Your event link
          </label>
          <div className="mt-2 flex gap-2 max-[641px]:flex-col">
            <input id="event-url" readOnly value={url} onFocus={(e) => e.target.select()} className="min-h-12 w-full min-w-0 rounded-[14px] border border-fx-red/20 bg-white px-4 text-[15px] text-fx-ink outline-none" />
            <button
              type="button"
              className={cx(button("primary"), "shrink-0")}
              onClick={() => {
                navigator.clipboard?.writeText(url).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {!published && <p className="mt-2 text-[13px] text-fx-red/78">The link works for you now; everyone else sees it once the event is published.</p>}
        </div>

        {published && (
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Share">
            {share.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold text-fx-red hover:border-fx-red">
                {s.label}
              </a>
            ))}
            <InstagramStoryButton d={d} url={url} when={start ? whenText(start) : ""} where={where} />
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <a href={url} className={button("red")}>
            View event page
          </a>
          <a href={created.dashboardUrl} className={button("outline")}>
            Go to dashboard
          </a>
          <a href={created.editUrl} className={button("outline")}>
            Edit event
          </a>
          <button type="button" onClick={onAnother} className="min-h-11 cursor-pointer px-2 text-[15px] font-semibold text-fx-red-second underline underline-offset-4">
            Create another event
          </button>
        </div>
      </div>
    </div>
  );
}
