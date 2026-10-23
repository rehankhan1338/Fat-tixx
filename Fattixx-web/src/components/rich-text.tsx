/* Renders an event description written with the /create editor's formatting (see src/lib/rich-text.ts). */

import { Fragment, type ReactNode } from "react";
import { parseRichText, type RichInline } from "@/lib/rich-text";

function inline(parts: RichInline[], key = ""): ReactNode[] {
  return parts.map((p, i) => {
    const k = `${key}${i}`;
    if (p.t === "text") return <Fragment key={k}>{p.v}</Fragment>;
    if (p.t === "b") return <strong key={k} className="font-semibold text-fx-red">{inline(p.c, k)}</strong>;
    if (p.t === "i") return <em key={k}>{inline(p.c, k)}</em>;
    const external = p.href.startsWith("http");
    return (
      <a key={k} href={p.href} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow ugc" } : {})} className="font-semibold text-fx-red-second underline underline-offset-[3px] hover:text-fx-red">
        {inline(p.c, k)}
      </a>
    );
  });
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseRichText(text);
  if (!blocks.length) return null;
  return (
    <div className={className}>
      {blocks.map((b, i) =>
        b.t === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l, `${i}-${j}-`)}
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i} className="grid list-disc gap-1 pl-6 marker:text-fx-red/60">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, `${i}-${j}-`)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
