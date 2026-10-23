/*
 * The event's YouTube video (plan 5.6, optional). Organizers paste any YouTube link; only the 11-character video id
 * matters. The event page shows the thumbnail and loads the player from youtube-nocookie.com when it is clicked.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/** "https://youtu.be/dQw4w9WgXcQ", "…/watch?v=…", "…/shorts/…", "…/embed/…", "…/live/…" → the video id, else null. */
export function youtubeId(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (ID.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m?.[1] ?? null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/** The link stored for the event, in one canonical form. */
export function youtubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
}

export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
