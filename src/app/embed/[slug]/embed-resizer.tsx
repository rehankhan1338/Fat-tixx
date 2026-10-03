"use client";

import { useEffect } from "react";

/** Tells the host page (embed.js) how tall the widget is, so the iframe never shows a scrollbar. */
export function EmbedResizer() {
  useEffect(() => {
    if (window.parent === window) return;
    const send = () => window.parent.postMessage({ type: "fattixx:height", height: document.documentElement.scrollHeight }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, []);
  return null;
}
