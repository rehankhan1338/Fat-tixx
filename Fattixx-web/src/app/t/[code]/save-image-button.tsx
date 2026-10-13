"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * Downloads the ticket as a JPG. It is a plain download link, so it works before (or without) hydration.
 * On iOS a download lands in the Files app, so there we open the share sheet instead ("Save Image" → Photos).
 * Safari only allows share() straight from the tap, so the image is fetched ahead of time.
 */
export function SaveTicketImageButton({ ticketCode, k }: { ticketCode: string; k: string }) {
  const href = `/t/${ticketCode}/image?k=${encodeURIComponent(k)}`;
  const name = `ticket-${ticketCode}.jpg`;
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isIOS() || !navigator.canShare) return;
    let cancelled = false;
    fetch(href, { cache: "no-store" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        const f = new File([blob], name, { type: "image/jpeg" });
        if (navigator.canShare({ files: [f] })) setFile(f);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [href, name]);

  function onClick(e: React.MouseEvent) {
    if (!file) return; // let the link download normally
    e.preventDefault();
    navigator.share({ files: [file], title: "Ticket" }).catch((err: Error) => {
      if (err.name === "AbortError") return;
      const url = URL.createObjectURL(file);
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  return (
    <Button nativeButton={false} render={<a href={href} download={name} onClick={onClick} />} className="bg-zinc-900 text-white hover:bg-zinc-800">
      <DownloadIcon /> Download ticket
    </Button>
  );
}
