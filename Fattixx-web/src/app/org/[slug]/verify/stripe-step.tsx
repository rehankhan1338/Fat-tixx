"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure"; // "/pure": Connect.js loads only when the step starts
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import { finishEmbeddedOnboarding, startEmbeddedOnboarding } from "@/lib/payments/connect-actions";
import type { ConnectState } from "@/lib/payments/connect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const LABEL: Record<ConnectState, { text: string; tone: string }> = {
  not_started: { text: "Not started", tone: "border-amber-500/40 text-amber-700" },
  incomplete: { text: "In progress", tone: "border-amber-500/40 text-amber-700" },
  pending: { text: "Stripe is verifying", tone: "border-sky-500/40 text-sky-700" },
  restricted: { text: "Action required", tone: "border-red-500/40 text-red-700" },
  active: { text: "Verified", tone: "border-emerald-500/40 text-emerald-700" },
};

/**
 * Verification step 2: Stripe's onboarding (identity, business or personal details, bank account) embedded in the
 * page. The organizer type from step 1 decides the Stripe account's business type; individuals need no EIN.
 */
export function StripeStep({ org, type, state, publishableKey, due }: { org: string; type: string; state: ConnectState; publishableKey: string; due: string[] }) {
  const router = useRouter();
  const [connect, setConnect] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const done = state === "pending" || state === "active";

  const start = async () => {
    setStarting(true); setError(null);
    const first = await startEmbeddedOnboarding(org, type);
    if (!first.clientSecret) { setError(first.error ?? "Stripe could not start the setup."); setStarting(false); return; }
    let secret: string | undefined = first.clientSecret;
    setConnect(loadConnectAndInitialize({
      publishableKey,
      // The first secret is used once; Stripe asks again when a session expires.
      fetchClientSecret: async () => {
        if (secret) { const s = secret; secret = undefined; return s; }
        const r = await startEmbeddedOnboarding(org, type);
        if (!r.clientSecret) throw new Error(r.error ?? "Stripe session failed");
        return r.clientSecret;
      },
      appearance: { variables: { fontFamily: "inherit" } },
    }));
    setStarting(false);
  };

  const exit = async () => {
    await finishEmbeddedOnboarding(org);
    setConnect(null);
    router.refresh();
  };

  return (
    <fieldset className="space-y-3" id="stripe">
      <legend className="flex flex-wrap items-center gap-2 text-base font-semibold">
        Step 2: Payouts with Stripe <Badge variant="outline" className={LABEL[state].tone}>{LABEL[state].text}</Badge>
      </legend>
      <p className="text-sm text-muted-foreground">
        {type === "individual"
          ? "Stripe verifies you with your personal details (name, date of birth, last 4 of your SSN) and the bank account you want to be paid into. No EIN needed."
          : "Stripe verifies your business details and the bank account you want to be paid into."}{" "}
        Ticket money is held safely and paid out after each event.
      </p>
      {state === "restricted" && due.length ? <p className="text-sm text-red-700 dark:text-red-300">Stripe needs: {due.slice(0, 6).map((d) => d.replace(/[._]/g, " ")).join(", ")}{due.length > 6 ? ", …" : ""}.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {connect ? (
        <div className="rounded-xl border p-4">
          <ConnectComponentsProvider connectInstance={connect}>
            <ConnectAccountOnboarding onExit={exit} collectionOptions={{ fields: "eventually_due", futureRequirements: "include" }} />
          </ConnectComponentsProvider>
        </div>
      ) : state === "active" ? (
        <p className="text-sm">Stripe has verified your payout details.</p>
      ) : (
        <Button type="button" variant={done ? "outline" : "default"} onClick={start} disabled={starting}>
          {starting ? <Loader2Icon className="animate-spin" /> : null}
          {state === "not_started" ? "Set up payouts" : done ? "Review details with Stripe" : "Continue with Stripe"}
        </Button>
      )}
    </fieldset>
  );
}
