"use client";

import { useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type ButtonProps = Omit<React.ComponentProps<typeof Button>, "render" | "nativeButton" | "children">;

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * Downloads a server-rendered JPG (ticket, receipt). It is a plain download link, so it works before (or without) hydration.
 * On iOS a download lands in the Files app, so there we open the share sheet instead ("Save Image" → Photos).
 * Safari only allows share() straight from the tap, so the image is fetched ahead of time.
 */
export function SaveImageButton({ href, filename, shareTitle, children, ...buttonProps }: { href: string; filename: string; shareTitle: string; children: React.ReactNode } & ButtonProps) {
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isIOS() || !navigator.canShare) return;
    let cancelled = false;
    fetch(href, { cache: "no-store" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        const f = new File([blob], filename, { type: "image/jpeg" });
        if (navigator.canShare({ files: [f] })) setFile(f);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [href, filename]);

  function onClick(e: React.MouseEvent) {
    if (!file) return; // let the link download normally
    e.preventDefault();
    navigator.share({ files: [file], title: shareTitle }).catch((err: Error) => {
      if (err.name === "AbortError") return;
      const url = URL.createObjectURL(file);
      Object.assign(document.createElement("a"), { href: url, download: filename }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  return (
    <Button {...buttonProps} nativeButton={false} render={<a href={href} download={filename} onClick={onClick} />}>
      <DownloadIcon /> {children}
    </Button>
  );
}
