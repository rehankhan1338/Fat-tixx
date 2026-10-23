/*
 * An Instagram Story picture of a new event (plan 5.6, the confirmation screen): 1080 × 1920, the cover on the brand red
 * with the name, date, place and link. Drawn in the browser; the organizer shares it to Instagram from their phone's
 * share sheet (Instagram has no web link for Stories) and adds a link sticker with the event link.
 */

const W = 1080;
const H = 1920;
const RED = "#A8121A";
const RED_DEEP = "#6E0A10";
const IVORY = "#F5F1EA";
const YELLOW = "#FFD23F";
const DISPLAY = '"Bricolage Grotesque", "IBM Plex Sans", system-ui, sans-serif';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lines of at most `width` pixels, and at most `max` lines (the last one ends with "…" when cut). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

export async function storyImage(e: { cover: string | null; name: string; when: string; where: string; url: string }): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the picture.");
  if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, RED);
  bg.addColorStop(1, RED_DEEP);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // the cover (4:5), or a plain card
  const cw = 760, ch = 950, cx = (W - cw) / 2, cy = 170;
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 40);
  ctx.clip();
  if (e.cover) {
    try {
      const img = await loadImage(e.cover);
      const k = Math.max(cw / img.width, ch / img.height);
      ctx.drawImage(img, cx + (cw - img.width * k) / 2, cy + (ch - img.height * k) / 2, img.width * k, img.height * k);
    } catch {
      ctx.fillStyle = YELLOW;
      ctx.fillRect(cx, cy, cw, ch);
    }
  } else {
    ctx.fillStyle = YELLOW;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = RED;
    ctx.font = `800 120px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.fillText("TIX", W / 2, cy + ch / 2 + 40);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = IVORY;
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText("FATTIXX", W / 2, 110);

  ctx.font = `700 76px ${DISPLAY}`;
  let y = cy + ch + 120;
  for (const line of wrap(ctx, e.name, W - 160, 2)) {
    ctx.fillText(line, W / 2, y);
    y += 84;
  }
  ctx.font = `500 40px ${SANS}`;
  ctx.fillStyle = "rgba(245,241,234,.86)";
  for (const line of [...wrap(ctx, e.when, W - 160, 1), ...wrap(ctx, e.where, W - 160, 1)]) {
    y += 10;
    ctx.fillText(line, W / 2, y);
    y += 46;
  }

  // the link, in a yellow pill near the bottom (above where Instagram puts its reply bar)
  ctx.font = `700 38px ${SANS}`;
  const label = e.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "");
  const text = wrap(ctx, label, W - 220, 1)[0] ?? "";
  const pw = Math.min(W - 140, ctx.measureText(text).width + 100);
  ctx.fillStyle = YELLOW;
  roundRect(ctx, (W - pw) / 2, H - 290, pw, 92, 46);
  ctx.fill();
  ctx.fillStyle = RED;
  ctx.fillText(text, W / 2, H - 230);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("image"))), "image/png"));
}
