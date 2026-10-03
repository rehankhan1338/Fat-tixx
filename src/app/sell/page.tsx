import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { getSession } from "@/lib/auth/session";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Sell tickets" };

export default async function SellPage() {
  const session = await getSession();
  return (
    <PublicShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sell tickets with Fat Tixx</h1>
          <p className="mt-2 text-muted-foreground">Tell us who you are. We verify every organizer before they can sell, which protects buyers and you. Most reviews take one to two business days.</p>
        </div>
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          <li className="rounded-lg border p-3"><strong className="block text-foreground">All-in pricing</strong>Fees shown up front, as the law requires.</li>
          <li className="rounded-lg border p-3"><strong className="block text-foreground">Fast door check-in</strong>Signed QR codes that keep working offline.</li>
          <li className="rounded-lg border p-3"><strong className="block text-foreground">Settlement statements</strong>Every fee, refund and tax line per event.</li>
        </ul>
        <ApplyForm defaultName={session?.user.name} defaultEmail={session?.user.email} />
        <p className="text-xs text-muted-foreground">By applying you agree to the <Link href="/organizer-agreement" className="underline">Organizer Agreement</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
      </div>
    </PublicShell>
  );
}
