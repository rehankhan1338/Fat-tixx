/*
 * Event descriptions with light formatting (plan 5.6): **bold**, *italics*, [links](https://…) and bullet lists
 * ("- " at the start of a line). Stored as this plain text, so older descriptions (paragraphs separated by a blank
 * line) read exactly as before. Parsed into a small tree that components render as React elements: no HTML is
 * stored or injected, and links only ever point at http(s) or mailto addresses.
 */

export type RichInline =
  | { t: "text"; v: string }
  | { t: "b"; c: RichInline[] }
  | { t: "i"; c: RichInline[] }
  | { t: "a"; href: string; c: RichInline[] };

export type RichBlock = { t: "p"; lines: RichInline[][] } | { t: "ul"; items: RichInline[][] };

const BULLET = /^\s*[-*•]\s+/;

/** http(s) and mailto only; anything else stays plain text */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/[^\s"'<>]+\.[^\s"'<>]+$/i.test(href)) return href;
  if (/^mailto:[^\s@"'<>]+@[^\s@"'<>]+\.[^\s"'<>]+$/i.test(href)) return href;
  return null;
}

const INLINE = /\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w])|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

export function parseInline(text: string, depth = 0): RichInline[] {
  const out: RichInline[] = [];
  let last = 0;
  const push = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev && prev.t === "text") prev.v += v;
    else out.push({ t: "text", v });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    push(text.slice(last, at));
    last = at + m[0].length;
    const inner = (s: string) => (depth < 3 ? parseInline(s, depth + 1) : [{ t: "text" as const, v: s }]);
    if (m[1] !== undefined) out.push({ t: "b", c: inner(m[1]) });
    else if (m[2] !== undefined) {
      const href = safeHref(m[3]);
      if (href) out.push({ t: "a", href, c: inner(m[2]) });
      else push(m[0]);
    } else if (m[4] !== undefined) out.push({ t: "i", c: inner(m[4]) });
    else if (m[5] !== undefined) out.push({ t: "i", c: inner(m[5]) });
    else if (m[6] !== undefined) {
      const href = safeHref(m[6]);
      if (href) out.push({ t: "a", href, c: [{ t: "text", v: m[6] }] });
      else push(m[0]);
    }
  }
  push(text.slice(last));
  return out;
}

/** Paragraphs (blank-line separated, single line breaks kept) and bullet lists. */
export function parseRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const chunk of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let para: string[] = [];
    let list: string[] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ t: "p", lines: para.map((l) => parseInline(l)) });
      para = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ t: "ul", items: list.map((l) => parseInline(l)) });
      list = [];
    };
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (BULLET.test(line)) {
        flushPara();
        list.push(line.replace(BULLET, ""));
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

function inlineText(parts: RichInline[]): string {
  return parts.map((p) => (p.t === "text" ? p.v : p.t === "a" ? inlineText(p.c) : inlineText(p.c))).join("");
}

/** The description without its formatting marks, for link previews, emails and search engines. */
export function richTextPlain(text: string): string {
  return parseRichText(text)
    .map((b) => (b.t === "p" ? b.lines.map(inlineText).join("\n") : b.items.map((i) => `• ${inlineText(i)}`).join("\n")))
    .join("\n\n");
}
