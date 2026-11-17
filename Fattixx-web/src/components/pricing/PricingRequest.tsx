"use client";

/* Top of /pricing for launch: organizers leave their email and the team sends pricing (src/lib/pricing-request.ts). */

import { useActionState } from "react";
import { BotFields } from "@/components/bot-fields";
import { Captcha } from "@/components/captcha";
import { button, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import { requestPricing } from "@/lib/pricing-request";
import type { PricingContent } from "@/lib/site-content/schema";
import { Lines } from "@/lib/site-content/inline";

export default function PricingRequest({ content: c }: { content: PricingContent["request"] }) {
  const [state, action, pending] = useActionState(requestPricing, undefined);

  return (
    <section aria-labelledby="pricing-h" className="relative bg-fx-white px-(--pad) pt-[168px] pb-[200px] max-[901px]:pt-[128px] max-[641px]:pb-[140px]">
      <div className="text-center">
        <div className={eyebrow}>{c.eyebrow}</div>
        <h1 id="pricing-h" className={cx(sectionTitle, "mx-auto mt-4 max-w-[960px] text-[clamp(44px,6vw,88px)] leading-[.94] tracking-[-0.05em]")}>
          <Lines text={c.title} />
        </h1>
        <p className="mx-auto mt-5 max-w-[520px] text-[18px] leading-[1.6] text-fx-red/78 max-[641px]:text-[16px]">{c.lead}</p>
      </div>

      <div className="mx-auto mt-11 max-w-[520px]">
        {state?.ok ? (
          <p role="status" className="rounded-[28px] border border-fx-red/20 bg-white px-6 py-5 text-center text-[16px] leading-[1.6] font-semibold">
            {c.success.replace("{email}", state.email ?? "your email")}
          </p>
        ) : (
          <form action={action} className="relative">
            <BotFields />
            <label htmlFor="pricing-email" className="sr-only">
              Email address
            </label>
            {/* input-group: the app-wide validator (form-validation.tsx) puts its message under the pill, not inside it */}
            <div
              data-slot="input-group"
              className={cx(
                "flex items-center gap-2 rounded-full border bg-white py-[7px] pr-[7px] pl-6 focus-within:border-fx-red",
                state?.error ? "border-fx-red" : "border-fx-red/30",
              )}
            >
              <input
                id="pricing-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                placeholder={c.placeholder}
                defaultValue={state?.email}
                aria-invalid={state?.error ? true : undefined}
                aria-describedby={state?.error ? "pricing-error" : "pricing-note"}
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[16px] text-fx-ink outline-none placeholder:text-fx-red/45 focus-visible:outline-none"
              />
              <button type="submit" disabled={pending} className={cx(button("primary", "sm"), "max-[400px]:px-4 disabled:opacity-60")}>
                {pending ? "Sending…" : c.button}
              </button>
            </div>
            {state?.error && (
              <p id="pricing-error" role="alert" className="mt-3 text-center text-[14px] font-semibold">
                {state.error}
              </p>
            )}
            <p id="pricing-note" className="mt-4 text-center text-[13px] text-fx-red/78">
              {c.note}
            </p>
            <div className="mt-4 flex justify-center">
              <Captcha />
            </div>
          </form>
        )}
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-px h-[90px] rounded-[50%_50%_0_0/90px_90px_0_0] bg-fx-ivory max-[641px]:h-[48px] max-[641px]:rounded-[50%_50%_0_0/48px_48px_0_0]" />
    </section>
  );
}
