"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js/pure"; // "/pure" loads Stripe.js only when loadStripe() runs, so free orders never load it
import type { Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2Icon, LockIcon } from "lucide-react";
import { completeFreeOrder, confirmPaymentClientSide, createPaymentIntent } from "@/lib/orders/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));
  const router = useRouter();
  useEffect(() => {
    const iv = setInterval(() => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setLeft(ms);
      if (ms === 0) { clearInterval(iv); router.refresh(); }
    }, 1000);
    return () => clearInterval(iv);
  }, [expiresAt, router]);
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  return <Badge variant="outline" className={left < 120000 ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : ""}>Reserved for {m}:{String(s).padStart(2, "0")}</Badge>;
}

export function FreeOrderButton({ code }: { code: string }) {
  const [state, action] = useActionState(completeFreeOrder, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} />
      <input type="hidden" name="code" value={code} />
      <SubmitButton className="w-full" size="lg" pendingText="Issuing tickets…">Confirm free tickets</SubmitButton>
    </form>
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function CheckoutPayment({ code, publishableKey, amountLabel }: { code: string; publishableKey: string; amountLabel: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    stripePromise ??= loadStripe(publishableKey);
    createPaymentIntent(code).then((r) => { if (r.error) setError(r.error); else setClientSecret(r.clientSecret ?? null); });
  }, [code, publishableKey]);
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!clientSecret || !stripePromise) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Preparing secure payment…</div>;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#f59e0b", borderRadius: "10px", fontFamily: "Geist, system-ui, sans-serif" } } }}>
      <PaymentForm code={code} amountLabel={amountLabel} />
    </Elements>
  );
}

function PaymentForm({ code, amountLabel }: { code: string; amountLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError(null);
    const { error: submitErr } = await elements.submit();
    if (submitErr) { setError(submitErr.message ?? "Check your card details."); setBusy(false); return; }
    const { error: confirmErr, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: `${window.location.origin}/orders/${code}` } });
    if (confirmErr) { setError(confirmErr.message ?? "Payment failed."); setBusy(false); return; }
    if (paymentIntent?.status === "succeeded") {
      const r = await confirmPaymentClientSide(code);
      if (!r.ok) { setError(r.error ?? "Payment could not be confirmed."); setBusy(false); return; }
      router.push(`/orders/${code}`);
      return;
    }
    setError("Payment is still processing. You will receive an email once it completes.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }} />
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Button type="submit" size="lg" className="w-full" disabled={!stripe || busy}>{busy ? <Loader2Icon className="animate-spin" /> : <LockIcon />} {busy ? "Processing…" : `Pay ${amountLabel}`}</Button>
      <p className="text-center text-xs text-muted-foreground">Secured by Stripe. Fat Tixx never sees or stores your card number.</p>
    </form>
  );
}
