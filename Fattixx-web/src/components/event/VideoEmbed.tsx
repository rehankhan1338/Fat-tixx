"use client";

/*
 * The event's YouTube video. Only the thumbnail loads with the page; the player (youtube-nocookie.com) is added when
 * the visitor presses play, so nothing from YouTube runs for people who never watch.
 */

import { useState } from "react";
import { youtubeEmbedUrl, youtubeThumb } from "@/lib/video";

export default function VideoEmbed({ id, title }: { id: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[22px] bg-fx-red-deep">
      {playing ? (
        <iframe
          src={youtubeEmbedUrl(id)}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 cursor-pointer" aria-label={`Play video: ${title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own thumbnail */}
          <img src={youtubeThumb(id)} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
          <span className="absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-fx-yellow text-fx-red shadow-[0_12px_30px_-10px_rgba(0,0,0,.5)] transition-transform group-hover:scale-105">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
