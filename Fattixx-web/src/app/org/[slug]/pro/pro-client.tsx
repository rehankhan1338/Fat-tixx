"use client";

import { useActionState, useState } from "react";
import { CreditCardIcon } from "lucide-react";
import { formatCents } from "@/lib/money";
import { PRO_MONTHLY_CENTS, PRO_YEARLY_CENTS, PRO_YEARLY_MONTHLY_CENTS, PRO_YEARLY_SAVINGS_CENTS } from "@/lib/home/pro";
import { startProCheckout, updateProCard } from "@/lib/pro/actions";
import { ActionButton } from "@/components/pro/action-button";
import { FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { cx } from "@/components/ui/styles";

/** Monthly or yearly, then Stripe Checkout. */
export function SubscribeForm({ org }: { org: string }) {
  const [state, action] = useActionState(startProCheckout, undefined);
  const [interval, setPlan] = useState<"month" | "year">("year");
  const option = (value: "month" | "year", title: string, price: string, note: string) => (
    <label className={cx("flex cursor-pointer flex-col gap-1 rounded-2xl border p-4", interval === value ? "border-fx-red bg-fx-red/5" : "border-fx-red/15 bg-white")}>
      <span className="flex items-center gap-2 font-semibold">
        <input type="radio" name="interval" value={value} checked={interval === value} onChange={() => setPlan(value)} className="accent-[var(--color-fx-red)]" />
        {title}
      </span>
      <span className="font-display text-[26px] font-semibold tabular-nums">{price}</span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </label>
  );
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <input type="hidden" name="org" value={org} />
      <div className="grid gap-3 sm:grid-cols-2">
        {option("year", "Yearly", `${formatCents(PRO_YEARLY_MONTHLY_CENTS)}/mo`, `Billed ${formatCents(PRO_YEARLY_CENTS)} once a year. Save ${formatCents(PRO_YEARLY_SAVINGS_CENTS)}.`)}
        {option("month", "Monthly", `${formatCents(PRO_MONTHLY_CENTS)}/mo`, "Billed every month. Cancel any time.")}
      </div>
      <p className="text-xs text-muted-foreground">Pro is billed on top of the usual per-ticket fee. You can switch between monthly and yearly or cancel at any time; Pro stays on until the end of the period you paid for.</p>
      <SubmitButton pendingText="Opening checkout…">Continue to payment</SubmitButton>
    </form>
  );
}

export function UpdateCardButton({ org }: { org: string }) {
  return (
    <ActionButton action={updateProCard} fields={{ org }} size="default">
      <CreditCardIcon /> Update card
    </ActionButton>
  );
}
