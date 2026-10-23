"use client";

/* Optional photos (up to 5) and a YouTube video for the event page (plan 5.6). */

import { useRef, useState } from "react";
import { cx } from "@/components/ui/styles";
import { MAX_PHOTOS, PHOTO_MAX, readImage, uid, type GalleryItem } from "@/lib/home/create";
import { youtubeId, youtubeUrl } from "@/lib/video";
import { FieldError, input, labelCls } from "./ui";

export function GalleryField({ items, onChange, error }: { items: GalleryItem[]; onChange: (items: GalleryItem[]) => void; error?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const left = MAX_PHOTOS - items.length;

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr("");
    setBusy(true);
    const added: GalleryItem[] = [];
    try {
      for (const f of Array.from(files).slice(0, left)) added.push({ id: uid("p"), src: await readImage(f, PHOTO_MAX, PHOTO_MAX, false) });
      if (files.length > left) setErr(`Only ${MAX_PHOTOS} photos fit; the rest were left out.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (added.length) onChange([...items, ...added]);
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const move = (i: number, by: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    onChange(next);
  };

  return (
    <div>
      <ul className="grid grid-cols-3 gap-3 max-[641px]:grid-cols-2">
        {items.map((p, i) => (
          <li key={p.id} className="group relative aspect-square overflow-hidden rounded-[16px] bg-fx-sand">
            {/* eslint-disable-next-line @next/next/no-img-element -- in-browser preview or a saved upload */}
            <img src={p.src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <div className="absolute inset-x-2 bottom-2 flex gap-1">
              {i > 0 && (
                <button type="button" onClick={() => move(i, -1)} aria-label={`Move photo ${i + 1} earlier`} className="min-h-9 cursor-pointer rounded-full bg-white/90 px-3 text-[13px] font-semibold text-fx-red">
                  ←
                </button>
              )}
              {i < items.length - 1 && (
                <button type="button" onClick={() => move(i, 1)} aria-label={`Move photo ${i + 1} later`} className="min-h-9 cursor-pointer rounded-full bg-white/90 px-3 text-[13px] font-semibold text-fx-red">
                  →
                </button>
              )}
              <button type="button" onClick={() => onChange(items.filter((x) => x.id !== p.id))} aria-label={`Remove photo ${i + 1}`} className="ml-auto min-h-9 cursor-pointer rounded-full bg-white/90 px-3 text-[13px] font-semibold text-fx-red">
                Remove
              </button>
            </div>
          </li>
        ))}
        {left > 0 && (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void add(e.dataTransfer.files);
              }}
              className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-[16px] border-2 border-dashed border-fx-red/25 text-center text-[14px] font-semibold hover:border-fx-red/50 disabled:opacity-60"
            >
              <span aria-hidden="true" className="text-[22px] leading-none">+</span>
              {busy ? "Adding…" : "Add photos"}
              <span className="text-[12px] font-normal text-fx-red/78">{left} left</span>
            </button>
          </li>
        )}
      </ul>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" tabIndex={-1} aria-label="Upload photos" onChange={(e) => void add(e.target.files)} />
      <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Up to {MAX_PHOTOS} photos: the venue, last year’s crowd, the lineup. Shown under the description.</p>
      <FieldError>{err || error}</FieldError>
    </div>
  );
}

export function VideoField({ value, onChange, error, id }: { value: string; onChange: (v: string) => void; error?: string; id: string }) {
  const vid = youtubeId(value);
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        YouTube video <span className="font-normal text-fx-red/78">(optional)</span>
      </label>
      <input id={id} type="url" inputMode="url" className={cx(input, "mt-2")} placeholder="https://youtu.be/…" value={value} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {error ? (
        <FieldError>{error}</FieldError>
      ) : vid ? (
        <p className="mt-2 mb-0 text-[13px] text-fx-red/78">
          Video found.{" "}
          <a href={youtubeUrl(vid)} target="_blank" rel="noopener noreferrer" className="font-semibold text-fx-red-second underline underline-offset-2">
            Watch it on YouTube
          </a>{" "}
          to check it’s the right one.
        </p>
      ) : (
        <p className="mt-2 mb-0 text-[13px] text-fx-red/78">A trailer, an aftermovie or a song. Paste the link from YouTube’s Share button.</p>
      )}
    </div>
  );
}
