"use client";

import { useEffect } from "react";

/** Tells the host page (embed.js) how tall the widget is, so the iframe never shows a scrollbar. */
export function EmbedResizer() {
  useEffect(() => {
    if (window.parent === window) return;
    // Measure the widget itself: <html>/<body> stretch to the iframe, so their height could only ever grow.
    const content = document.querySelector("main") ?? document.body;
    const send = () => window.parent.postMessage({ type: "fattixx:height", height: Math.ceil(content.getBoundingClientRect().height) }, "*");
    const ro = new ResizeObserver(send);
    ro.observe(content);
    send();
    return () => ro.disconnect();
  }, []);
  return null;
}
