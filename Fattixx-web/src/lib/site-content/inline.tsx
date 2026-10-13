/* Rendering helpers for admin-edited copy: "\n" becomes a line break; "[label](href)" becomes a link. Nothing else is interpreted. */

import { Fragment, type ReactNode } from "react";
import Link from "next/link";

/** Multi-line heading: each "\n" in the text is a <br />. */
export function Lines({ text }: { text: string }) {
  const parts = text.split("\n");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {p}
        </Fragment>
      ))}
    </>
  );
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Paragraph text with inline links. Same-site links use next/link; mailto and external links are plain anchors. */
export function Rich({ text, linkClass = "font-semibold text-fx-red-second underline underline-offset-4" }: { text: string; linkClass?: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, label, href] = m;
    out.push(
      href.startsWith("/") ? (
        <Link key={m.index} href={href} className={linkClass}>
          {label}
        </Link>
      ) : (
        <a key={m.index} href={href} className={linkClass} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {label}
        </a>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
