import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/public-shell";
import { getSession } from "@/lib/auth/session";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Sell tickets" };

/**
 * Organizer sign-up: a few skippable questions about the organizer's events, then the contact and business details
 * we verify. The step is kept in `?step=` so the browser's back button returns to the previous question; the answers
 * live only in the page, so a reload starts again at the first question.
 */
export default async function SellPage({ searchParams }: PageProps<"/sell">) {
  const [session, sp] = await Promise.all([getSession(), searchParams]);
  if (sp.step !== undefined) {
    const keep = new URLSearchParams();
    for (const k of ["plan", "reason"]) { const v = sp[k]; if (typeof v === "string") keep.set(k, v); }
    const qs = keep.toString();
    redirect(qs ? `/sell?${qs}` : "/sell");
  }
  const pro = sp.plan === "pro";
  const notices = [
    sp.reason === "create" ? "Events are created by approved organizers. Apply here; once your organization is verified you can create and publish events." : null,
    pro ? "Fattixx Pro is not available yet. Apply as an organizer and we will contact you when it launches." : null,
  ].filter((n): n is string => !!n);
  return (
    <PublicShell>
      <ApplyForm defaultName={session?.user.name} defaultEmail={session?.user.email} defaultEvents={pro ? "Interested in Fattixx Pro. " : undefined} notices={notices} />
    </PublicShell>
  );
}
