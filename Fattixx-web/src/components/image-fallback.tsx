"use client";

import { useEffect } from "react";

/**
 * App-wide fallback for uploaded images that fail to load (a file removed from storage, an old store that no longer
 * exists). Instead of the browser's broken-image icon the <img> is shown as a muted box with a picture icon, styled by
 * `img[data-fx-img-fallback]` in globals.css. Only uploads are touched; the site's own static images are left alone.
 * Works for plain <img> and next/image (whose src is /_next/image?url=<encoded upload URL>).
 */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const UPLOAD_MARKERS = ["/api/uploads/", ".digitaloceanspaces.com/", ".blob.vercel-storage.com/"];

function isUpload(img: HTMLImageElement): boolean {
  const src = img.getAttribute("src") ?? "";
  if (!src || src === BLANK) return false;
  let decoded = src;
  try { decoded = decodeURIComponent(src); } catch { /* keep the raw value */ }
  return UPLOAD_MARKERS.some((m) => decoded.includes(m));
}

function showFallback(img: HTMLImageElement) {
  if (img.hasAttribute("data-fx-img-fallback") || !isUpload(img)) return;
  img.setAttribute("data-fx-img-fallback", "");
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  img.src = BLANK;
}

export function ImageFallback() {
  useEffect(() => {
    const onError = (e: Event) => {
      if (e.target instanceof HTMLImageElement) showFallback(e.target);
    };
    // A real image loaded into an element that showed the fallback before (e.g. React gave it a new src).
    const onLoad = (e: Event) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.hasAttribute("data-fx-img-fallback") && img.getAttribute("src") !== BLANK) {
        img.removeAttribute("data-fx-img-fallback");
      }
    };
    // error/load don't bubble; listening in the capture phase sees them for every <img> on the page.
    document.addEventListener("error", onError, true);
    document.addEventListener("load", onLoad, true);
    // Images that already failed before this ran (server-rendered, before hydration).
    for (const img of Array.from(document.images)) {
      if (img.complete && img.naturalWidth === 0) showFallback(img);
    }
    return () => {
      document.removeEventListener("error", onError, true);
      document.removeEventListener("load", onLoad, true);
    };
  }, []);
  return null;
}
