import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { googleConfig, readPendingSignup } from "@/lib/auth/passwordless";
import { siteFees } from "@/lib/home/data";
import { FeesProvider } from "@/lib/home/fees-context";
import { hostOrganizations, ownDrafts, venuesByOrg } from "@/lib/home/create-context";
import { getSettings } from "@/lib/settings";
import { listCategories } from "@/lib/site-content/categories";
import CreateEvent from "@/components/create/CreateEvent";

export const metadata: Metadata = {
  title: "Create an event",
  description: "Create your event on Fattixx in a few minutes. No account needed to start: sign up at the end with your email, phone or Google.",
  robots: { index: false },
};

const GOOGLE_NOTICES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. Your event is still here.",
  error: "Google sign-in didn’t work. Try again, or continue with your email.",
  off: "Google sign-in isn’t available right now. Continue with your email or phone.",
};

/**
 * One long form, saved in the browser as the organizer types (plan 5.6). Anyone can fill it in; the sign-up window at
 * the end signs them in (email or text code, or Google) and, for a new organizer, creates their organization. The lists
 * on the page come from the database: categories (Super Admin → Fees & Settings), each organization's saved venues and
 * the platform's default for who pays the fees. Organizers in their dashboard use the same page at
 * /org/<slug>/events/new and /org/<slug>/events/<id>/edit.
 */
export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const sp = await searchParams;
  // older links from the dashboard
  if (typeof sp.org === "string" && /^[a-z0-9-]{1,64}$/.test(sp.org)) {
    redirect(typeof sp.event === "string" && /^\d+$/.test(sp.event) ? `/org/${sp.org}/events/${sp.event}/edit` : `/org/${sp.org}/events/new`);
  }
  const [session, fees, categories, settings, pending] = await Promise.all([getSession(), siteFees(), listCategories(), getSettings(), readPendingSignup()]);
  const organizations = session ? await hostOrganizations(session.user.id) : [];
  const [venues, drafts] = await Promise.all([venuesByOrg(organizations), session ? ownDrafts(session.user.id) : Promise.resolve([])]);
  const notice = typeof sp.google === "string" ? GOOGLE_NOTICES[sp.google] ?? null : typeof sp.google_error === "string" ? sp.google_error.slice(0, 200) : null;
  const resume = sp.signup === "1" && pending ? "signup" : sp.signedin === "1" && session ? "signedin" : null;

  return (
    <div className="fx-home">
      <FeesProvider fees={fees}>
        <CreateEvent
          signedIn={!!session}
          organizations={organizations}
          categories={categories}
          venuesByOrg={venues}
          defaultFeePayer={settings.default_fee_mode === "organizer_absorbs" ? "organizer" : "buyer"}
          auth={{ googleEnabled: !!googleConfig(), pending, resume, notice }}
          drafts={drafts}
        />
      </FeesProvider>
    </div>
  );
}
