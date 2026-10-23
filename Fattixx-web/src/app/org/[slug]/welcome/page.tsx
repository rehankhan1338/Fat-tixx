import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { WelcomeForm } from "./welcome-form";

export const metadata: Metadata = { title: "Welcome" };

/** The organizer sign-up questionnaire for organizations created on /create (project plan, "Organizer Sign Up"). */
export default async function WelcomePage({ params }: PageProps<"/org/[slug]/welcome">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  if (ctx.org.questionnaire_done_at) redirect(`/org/${slug}`);
  return <WelcomeForm org={slug} />;
}
