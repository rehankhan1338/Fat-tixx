"use client";

/* Referral rewards on the event page and order page (11.9): "Earn $5 for every ticket sold through your link." */

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { joinPublicOffer } from "@/lib/social/referral-actions";
import { button, cx } from "@/components/ui/styles";

export default function EarnBox({ eventId, reward, link: initialLink, signedIn, holder, appUrl, className }: {
  eventId: number; reward: string; link: string | null; signedIn: boolean; holder: boolean; appUrl: string; className?: string;
}) {
  const [link, setLink] = useState(initialLink);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const path = usePathname();
  const router = useRouter();

  return (
    <section aria-labelledby="earn-h" className={cx("rounded-[22px] border border-fx-yellow bg-fx-yellow/25 px-5 py-5 text-fx-red", className)}>
      <h2 id="earn-h" className="font-display text-[19px] font-semibold">Earn {reward} by bringing friends</h2>
      {link ? (
        <>
          <p className="mt-1 text-[14px] text-fx-red/80">Share your personal link. Rewards are paid after the event. Your friends pay the same price.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded-full bg-white px-4 py-2 text-[14px]">{link}</code>
            <button type="button" className={button("red", "sm")} onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* blocked */ } }}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <Link href="/account/referrals" className="text-[14px] font-semibold underline underline-offset-[3px]">Your earnings</Link>
          </div>
          <p className="mt-2 text-[12px] text-fx-red/70">When you post about the event, say that you earn a reward (for example #ad or “I earn from ticket sales”).</p>
        </>
      ) : !signedIn ? (
        <p className="mt-1 text-[14px] text-fx-red/80">
          Ticket holders get a personal link and earn for every ticket sold through it.{" "}
          <Link href={`/login?next=${encodeURIComponent(path)}`} className="font-semibold underline underline-offset-[3px]">Sign in</Link> to get yours.
        </p>
      ) : !holder ? (
        <p className="mt-1 text-[14px] text-fx-red/80">Buy a ticket, then come back for your personal link.</p>
      ) : (
        <form className="mt-2 grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const r = await joinPublicOffer(eventId, terms);
            if (r?.url) setLink(r.url);
            else if (r?.error === "signin") router.push(`/login?next=${encodeURIComponent(path)}`);
            else setError(r?.error ?? "Couldn’t create your link.");
          });
        }}>
          <label className="flex items-start gap-3 text-[14px]">
            <input type="checkbox" className="mt-1 size-4 accent-fx-red" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
            <span>
              I agree to the <a href={`${appUrl}/referral-terms`} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-[3px]">Referral Rewards Terms</a>, including saying that I earn a reward when I promote this event.
            </span>
          </label>
          <button type="submit" disabled={pending || !terms} className={cx(button("red", "sm"), "w-fit disabled:opacity-60")}>{pending ? "Creating…" : "Get my link"}</button>
          {error && <p role="alert" className="text-[14px]">{error}</p>}
        </form>
      )}
    </section>
  );
}
