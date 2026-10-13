/* Policy content is loaded from content/legal/*.md by lib/legal.ts. */

import Link from "next/link";
import type { ReactNode } from "react";
import { container, cx } from "@/components/ui/styles";
import { LEGAL_PAGES } from "@/lib/home/legal";
import type { Block, Inline, LegalContent } from "@/lib/home/legal";
import LegalToc from "./LegalToc";

const linkCls = "font-medium text-fx-red-second underline decoration-fx-red-second/35 underline-offset-[3px] hover:decoration-fx-red-second";

function Text({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        let node: ReactNode = p.v;
        if (p.t === "link") {
          node = p.external ? (
            <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className={linkCls}>
              {p.v}
            </a>
          ) : p.href.startsWith("/") ? (
            <Link key={i} href={p.href} className={linkCls}>
              {p.v}
            </Link>
          ) : (
            <a key={i} href={p.href} className={linkCls}>
              {p.v}
            </a>
          );
        } else if (p.mark) {
          node = (
            <mark key={i} className="rounded bg-fx-yellow/60 px-1 text-fx-ink">
              {p.v}
            </mark>
          );
        }
        if (p.b) return <strong key={i} className="font-semibold text-fx-ink">{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "h2":
      return (
        <h2 id={b.id} className="mt-14 scroll-mt-28 border-t border-fx-red/12 pt-10 font-display text-[clamp(22px,2.4vw,28px)] leading-[1.15] font-semibold tracking-[-0.02em] text-fx-red first:mt-0 first:border-0 first:pt-0">
          {b.alias && <span id={b.alias} className="block scroll-mt-28" aria-hidden="true" />}
          {b.text}
        </h2>
      );
    case "p":
      return (
        <p id={b.id} className={cx("mt-4 scroll-mt-28", b.id && "target:rounded-lg target:bg-fx-yellow/25 target:outline-8 target:outline-fx-yellow/25")}>
          <Text parts={b.parts} />
        </p>
      );
    case "ul":
      return (
        <ul className="mt-4 flex list-none flex-col gap-2.5 pl-0">
          {b.items.map((it, i) => (
            <li key={i} className="relative pl-6 before:absolute before:top-[.72em] before:left-1.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-fx-red/45">
              <Text parts={it} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="mt-5 overflow-hidden rounded-2xl border border-fx-red/14">
          <table className="w-full border-collapse text-left text-[15px] leading-[1.55] max-[641px]:block">
            <thead className="bg-fx-sand max-[641px]:hidden">
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className="px-4 py-3 align-top text-[13px] font-semibold tracking-[.06em] text-fx-red uppercase">
                    <Text parts={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="max-[641px]:block">
              {b.rows.map((r, i) => (
                <tr key={i} className="border-t border-fx-red/10 max-[641px]:block max-[641px]:px-4 max-[641px]:py-3 max-[641px]:first:border-0">
                  {r.map((c, j) => (
                    <td key={j} className={cx("px-4 py-3 align-top max-[641px]:block max-[641px]:p-0", j === 0 ? "w-[30%] font-semibold text-fx-ink max-[641px]:w-auto" : "max-[641px]:mt-1")}>
                      <Text parts={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default function LegalPage({ content }: { content: LegalContent }) {
  const { doc, title, effective, blocks, toc } = content;
  return (
    <main className="bg-fx-ivory pb-28 max-[721px]:pb-20">
      <header id="top" className={cx(container, "pt-[140px] pb-10 max-[721px]:pt-[112px] max-[721px]:pb-8")}>
        <h1 className="font-display text-[clamp(40px,6vw,72px)] leading-[.95] font-semibold tracking-[-0.045em] text-fx-red">{title}</h1>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
          <nav aria-label="Policy pages" className="inline-flex rounded-full bg-white p-1 shadow-[0_1px_0_rgba(78,7,11,.06)] ring-1 ring-fx-red/12 print:hidden">
            {LEGAL_PAGES.map((p) => (
              <Link
                key={p.doc}
                href={p.href}
                aria-current={p.doc === doc ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-10 items-center rounded-full px-4 text-[14px] font-semibold whitespace-nowrap transition-colors",
                  p.doc === doc ? "bg-fx-red text-fx-ivory" : "text-fx-red/78 hover:text-fx-red",
                )}
              >
                {p.label}
              </Link>
            ))}
          </nav>
          {effective && <p className="text-[14px] text-fx-red/78">Effective {effective}</p>}
        </div>
      </header>

      <div className={cx(container, "grid grid-cols-[240px_minmax(0,1fr)] items-start gap-14 max-[901px]:grid-cols-1 max-[901px]:gap-6")}>
        <LegalToc toc={toc} />
        <article className="max-w-[760px] [&>*:first-child]:mt-0 rounded-[28px] bg-white px-12 py-12 text-[16px] leading-[1.7] text-fx-ink/85 shadow-[0_30px_60px_-45px_rgba(78,7,11,.45)] max-[721px]:rounded-[22px] max-[721px]:px-6 max-[721px]:py-8 max-[721px]:text-[15.5px] print:max-w-none print:p-0 print:shadow-none">
          {blocks.map((b, i) => (
            <BlockView key={i} b={b} />
          ))}
          <p className="mt-12 border-t border-fx-red/12 pt-6 text-[14px] text-fx-red/78 print:hidden">
            <a href="#top" className={linkCls}>
              Back to top
            </a>
            <span className="mx-3" aria-hidden="true">
              ·
            </span>
            {doc === "terms" ? (
              <Link href="/privacy" className={linkCls}>
                Read the Privacy Policy
              </Link>
            ) : (
              <Link href="/terms" className={linkCls}>
                Read the Terms of Service
              </Link>
            )}
          </p>
        </article>
      </div>
    </main>
  );
}
