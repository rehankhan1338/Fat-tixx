/*
 * Build-time policy parser; supports a limited Markdown subset (see README).
 * Section anchors use s-5 / s-5-4; Terms section 6 also has organizer-agreement.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";

export type LegalDoc = "terms" | "privacy";

export type Inline =
  | { t: "text"; v: string; b?: boolean; mark?: boolean }
  | { t: "link"; v: string; href: string; b?: boolean; external?: boolean };

export type Block =
  | { t: "h2"; id: string; alias?: string; text: string }
  | { t: "p"; id?: string; parts: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] };

export type LegalContent = {
  doc: LegalDoc;
  title: string;
  effective: string;
  blocks: Block[];
  toc: { id: string; text: string }[];
};

export const LEGAL_PAGES: { doc: LegalDoc; href: string; label: string }[] = [
  { doc: "terms", href: "/terms", label: "Terms of Service" },
  { doc: "privacy", href: "/privacy", label: "Privacy Policy" },
];

const ALIASES: Record<string, string> = { "s-6": "organizer-agreement" };

/** "5. Buying tickets" -> "s-5"; "6.4" -> "s-6-4" */
const anchor = (num: string) => "s-" + num.replace(/\.$/, "").replace(/\./g, "-");

export function loadLegal(doc: LegalDoc): LegalContent {
  const src = fs.readFileSync(path.join(process.cwd(), "content", "legal", `${doc}.md`), "utf8");
  const lines = src.split(/\r?\n/);

  // first pass: which anchors exist, so cross-references only link to real targets
  const ids = new Set<string>();
  for (const l of lines) {
    const h = l.match(/^## (\d+)\./);
    if (h) ids.add(anchor(h[1]));
    const c = l.match(/^\*\*(\d+\.\d+) /);
    if (c) ids.add(anchor(c[1]));
  }
  const other: LegalDoc = doc === "terms" ? "privacy" : "terms";

  const inline = (text: string): Inline[] => {
    const out: Inline[] = [];
    const re = /(\*\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
    let bold = false;
    let last = 0;
    let m: RegExpExecArray | null;
    const pushText = (s: string) => {
      if (s) out.push(...crossLinks(s, bold));
    };
    while ((m = re.exec(text))) {
      pushText(text.slice(last, m.index));
      last = re.lastIndex;
      if (m[1] === "**") bold = !bold;
      else out.push({ t: "link", v: m[2], href: m[3], b: bold, external: /^https?:/.test(m[3]) });
    }
    pushText(text.slice(last));
    return out;
  };

  // section references, the other policy's name, bare emails and [PLACEHOLDERS]
  const crossLinks = (s: string, b: boolean): Inline[] => {
    const out: Inline[] = [];
    const re =
      /\b(sections?) (\d+(?:\.\d+)?)((?:,? (?:and|or|through) \d+(?:\.\d+)?)*)( of the (?:Privacy Policy|Terms of Service))?|([\w.+-]+@[\w-]+\.[\w.]+\w)|(\[[A-Z][A-Z0-9 ,.'-]{6,}\])|(?<!Stripe )(Privacy Policy)(?=[ .,;])/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index), b });
      last = re.lastIndex;
      if (m[5]) out.push({ t: "link", v: m[5], href: `mailto:${m[5]}`, b });
      else if (m[6]) out.push({ t: "text", v: m[6], b, mark: true });
      else if (m[7]) {
        if (doc === "terms") out.push({ t: "link", v: m[7], href: "/privacy", b });
        else out.push({ t: "text", v: m[7], b });
      } else {
        const elsewhere = !!m[4];
        const target = elsewhere ? other : doc;
        const link = (num: string, label = num): Inline => {
          const id = anchor(num);
          if (!elsewhere && !ids.has(id)) return { t: "text", v: label, b };
          return { t: "link", v: label, href: elsewhere ? `/${target}#${id}` : `#${id}`, b };
        };
        // the first link includes the word: "section 5.4" / "sections 6.3"
        out.push(link(m[2], `${m[1]} ${m[2]}`));
        if (m[3]) {
          const rest = /(,? (?:and|or|through) )(\d+(?:\.\d+)?)/g;
          let r: RegExpExecArray | null;
          while ((r = rest.exec(m[3]))) out.push({ t: "text", v: r[1], b }, link(r[2]));
        }
        if (m[4]) out.push({ t: "text", v: m[4], b });
      }
    }
    if (last < s.length) out.push({ t: "text", v: s.slice(last), b });
    return out;
  };

  let title = "";
  let effective = "";
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith("# ")) {
      title = l.slice(2).trim();
    } else if (/^Effective date:/i.test(l)) {
      effective = l.replace(/^Effective date:\s*/i, "");
    } else if (l.startsWith("## ")) {
      const text = l.slice(3).trim();
      const num = text.match(/^(\d+)\./);
      const id = num ? anchor(num[1]) : text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      blocks.push({ t: "h2", id, alias: ALIASES[id] && doc === "terms" ? ALIASES[id] : undefined, text });
    } else if (l.startsWith("- ")) {
      const items: Inline[][] = [];
      while (i < lines.length && (lines[i].trim().startsWith("- ") || !lines[i].trim())) {
        const t = lines[i].trim();
        if (t) items.push(inline(t.slice(2)));
        else if (!(lines[i + 1] ?? "").trim().startsWith("- ")) break;
        i++;
      }
      i--;
      blocks.push({ t: "ul", items });
    } else if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const t = lines[i].trim();
        if (!/^\|[\s|:-]+\|$/.test(t)) rows.push(t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      blocks.push({ t: "table", head: rows[0].map(inline), rows: rows.slice(1).map((r) => r.map(inline)) });
    } else {
      const clause = l.match(/^\*\*(\d+\.\d+) /);
      blocks.push({ t: "p", id: clause ? anchor(clause[1]) : undefined, parts: inline(l) });
    }
  }

  const toc = blocks.filter((b): b is Extract<Block, { t: "h2" }> => b.t === "h2").map((b) => ({ id: b.id, text: b.text }));
  return { doc, title, effective, blocks, toc };
}
