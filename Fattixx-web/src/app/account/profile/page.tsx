import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { getSocialUser } from "@/lib/social/core";
import { listCategories } from "@/lib/site-content/categories";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { AccountNav } from "../account-nav";
import { PrivacyForm, ProfileForm } from "./profile-forms";

export const metadata: Metadata = { title: "Your profile", robots: { index: false } };

/* Profile and privacy settings (Social & Community 11.3, 11.11). */
export default async function ProfileSettingsPage({ searchParams }: PageProps<"/account/profile">) {
  const session = await requireSession();
  const sp = await searchParams;
  const [me, categories] = await Promise.all([getSocialUser(session.user.id), listCategories()]);
  if (!me) return null;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : null;
  return (
    <PublicShell>
      <PageHeader title="Your profile" description="Your public page on Fattixx. Social features are optional; buying tickets never needs a profile."
        actions={me.username ? <Button variant="outline" render={<Link href={`/u/${me.username}`} />}>View profile</Button> : null} />
      <AccountNav active="profile" />
      <div className="mt-6 space-y-8">
        <Section title="Profile" description="Your photo, name, username and links. Profiles never show your tickets, prices, orders or QR codes.">
          <ProfileForm next={next} categories={categories.map((c) => c.name)} me={{
            username: me.username ?? "", name: me.name, bio: me.bio ?? "", city: me.city ?? "", instagram: me.instagram ?? "", tiktok: me.tiktok ?? "", x: me.x_handle ?? "",
            avatar: uploadUrl(me.avatar_path), adult: !!me.age_confirmed_at, favorites: (me.favorite_categories ?? "").split(",").filter(Boolean),
          }} />
        </Section>
        <Section title="Privacy" description="Choose what other people can see and how you hear from organizers.">
          <PrivacyForm disabled={!me.username} values={{
            profilePublic: !!me.profile_public, guestLists: !!me.show_on_guest_lists, eventsOnProfile: !!me.show_events_on_profile,
            approval: !!me.follow_approval, marketing: !!me.marketing_opt_in, socialSms: !!me.social_sms_opt_in, hasPhone: !!me.phone,
          }} />
        </Section>
      </div>
    </PublicShell>
  );
}

