"use client";

/*
 * "Share that you're going" (11.8) after checkout and on the ticket page. The Story picture (9:16) is made on the server
 * from the event's cover (/api/share/<slug>/story); phones hand it to the share sheet, where Instagram offers "Story",
 * other browsers download it. The link carries the buyer's referral code when they joined the event's referral rewards,
 * otherwise ?via=<username> so the organizer's reports can count sales from shares.
 */

import { useState } from "react";
import { recordShare } from "@/lib/social/org-actions";
import { cx } from "@/components/ui/styles";

const pill = "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold text-fx-red hover:border-fx-red disabled:opacity-60";

export default function ShareGoing({ eventId, title, shareUrl, storyImage, postImage, earning, className }: {
  eventId: number; title: string; shareUrl: string; storyImage: string; postImage: string;
  /** the link is the buyer's referral link */
  earning?: boolean; className?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = `I’m going to ${title}! Get your tickets:`;
  const log = (channel: string) => { void recordShare(eventId, channel).catch(() => {}); };

  async function shareImage(src: string, name: string, channel: "story" | "native") {
    setBusy(true);
    setNote(null);
    try {
      const blob = await (await fetch(src)).blob();
      const file = new File([blob], name, { type: "image/png" });
      try { await navigator.clipboard?.writeText(shareUrl); } catch { /* clipboard blocked */ }
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text: `${text} ${shareUrl}` });
        setNote(channel === "story" ? "Pick Instagram, then Story. Your link is copied: add it with the Link sticker." : "Shared.");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setNote(channel === "story" ? "Picture saved. Post it as a Story from Instagram on your phone and add your link (copied) with the Link sticker." : "Picture saved, link copied.");
      }
      log(channel);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Couldn’t make the picture here. Copy the link instead.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl); setNote("Link copied."); log("copy"); } catch { setNote(shareUrl); }
  }

  const enc = encodeURIComponent;
  const links = [
    { channel: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${enc(`${text} ${shareUrl}`)}` },
    { channel: "x", label: "X", href: `https://x.com/intent/post?text=${enc(text)}&url=${enc(shareUrl)}` },
    { channel: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}` },
    { channel: "sms", label: "Text", href: `sms:?&body=${enc(`${text} ${shareUrl}`)}` },
  ];

  return (
    <div className={cx("text-fx-red", className)}>
      {earning && <p className="mb-3 text-[14px] text-fx-red/80">This is your referral link: you earn a reward for tickets sold through it.</p>}
      <div className="flex flex-wrap gap-2" aria-label="Share that you’re going">
        <button type="button" className={pill} disabled={busy} onClick={() => shareImage(storyImage, "im-going-story.png", "story")}>
          {busy ? "Making your picture…" : "Instagram Story"}
        </button>
        <button type="button" className={pill} disabled={busy} onClick={() => shareImage(postImage, "im-going.png", "native")}>Share picture</button>
        <button type="button" className={pill} onClick={copy}>Copy link</button>
        {links.map((l) => (
          <a key={l.channel} href={l.href} target="_blank" rel="noopener noreferrer" className={pill} onClick={() => log(l.channel)}>{l.label}</a>
        ))}
      </div>
      {note && <p role="status" className="mt-3 text-[14px] text-fx-red/80">{note}</p>}
    </div>
  );
}
