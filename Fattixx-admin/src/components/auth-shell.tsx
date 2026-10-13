import Link from "next/link";
import type { ReactNode } from "react";
import Logo from "@/components/home/Logo";
import { cardShadow, cx } from "@/components/ui/styles";

/**
 * Centered sign-in card for the admin console: no public navigation, nothing to browse. The card is marked
 * `fx-form` so the app's form controls take the brand colours (see the main app's globals.css).
 */
export function AdminAuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-fx-ivory px-4 pt-24 pb-16">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 text-center">
          <Link href="/" className="mb-6 inline-flex" aria-label="Fattixx admin home">
            <Logo height={48} />
          </Link>
          <h1 className="font-display text-[clamp(30px,3.4vw,40px)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-fx-red">{title}</h1>
          {subtitle ? <p className="mx-auto mt-3 max-w-[380px] text-[15px] leading-[1.55] text-fx-red/78">{subtitle}</p> : null}
        </div>
        <div className={cx("fx-form rounded-[28px] border border-fx-red/10 bg-white p-6 text-fx-ink max-[641px]:p-5", cardShadow)}>{children}</div>
        {footer ? <div className="fx-form mt-5 text-center text-[14px] leading-[1.6] text-fx-red/78 [&_a]:inline-flex [&_a]:min-h-8 [&_a]:items-center">{footer}</div> : null}
      </div>
    </main>
  );
}
