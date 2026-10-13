import Link from "next/link";
import { button, cx, sectionTitle } from "@/components/ui/styles";
import { formatCents } from "@/lib/home/pricing";
import { PRO_MONTHLY_CENTS, PRO_SIGNUP_HREF, PRO_YEARLY_MONTHLY_CENTS } from "@/lib/home/pro";

export default function ProHero() {
  return (
    <section aria-labelledby="pro-h" className="relative overflow-hidden bg-fx-white px-(--pad) pt-[160px] pb-[120px] max-[901px]:pt-[124px] max-[641px]:pb-[96px]">
      <div className="text-center">
        <h1 id="pro-h" className={cx(sectionTitle, "text-[clamp(46px,6.2vw,92px)] leading-[.92] tracking-[-0.05em] text-balance")}>
          Your brand.<br />Your tickets.
        </h1>
        <p className="mx-auto mt-6 max-w-[520px] text-[18px] leading-[1.6] text-fx-red/78 max-[641px]:text-[16px]">
          Sell from your own web address with your logo and colors, and no third-party ads. Plus reserved seating, email marketing and deeper reports.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-[10px]">
          <Link href={PRO_SIGNUP_HREF} className={button("primary")}>Get Fattixx Pro</Link>
          <a href="#pricing" className={button("outline")}>See pricing</a>
        </div>
        <p className="mt-4 text-[14px] text-fx-red/78">
          {formatCents(PRO_MONTHLY_CENTS)} a month, or {formatCents(PRO_YEARLY_MONTHLY_CENTS)} a month billed yearly. Same ticket fee.
        </p>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-px h-[90px] rounded-[50%_50%_0_0/90px_90px_0_0] bg-fx-ivory max-[641px]:h-[48px] max-[641px]:rounded-[50%_50%_0_0/48px_48px_0_0]"
      />
    </section>
  );
}
