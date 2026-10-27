import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/return-url";
import { Forward } from "./forward";

export const metadata: Metadata = { title: "Returning to Fattixx", robots: { index: false } };

/** Landing page for returns from Stripe (see src/lib/return-url.ts). */
export default async function ReturnPage({ searchParams }: PageProps<"/return">) {
  const to = safeReturnPath((await searchParams).to);
  if (!to) redirect("/");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-display text-xl font-semibold">Taking you back to Fattixx…</p>
      <Forward to={to} />
    </main>
  );
}
