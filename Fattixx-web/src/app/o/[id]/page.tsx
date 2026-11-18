import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { organizerPage } from "@/lib/home/data";
import { getSession } from "@/lib/auth/session";
import { orgFollowInfo } from "@/lib/social/queries";
import { organizerHref } from "@/lib/home/events";
import { organizerMetadata } from "@/lib/home/organizer-metadata";
import { PublicPage } from "@/components/layout/PublicPage";
import OrganizerPage from "@/components/organizer/OrganizerPage";

/*
 * Organizer page: fattixx.com/o/<organization slug>. Linked from the event page's organizer card and the event tiles.
 * A Fattixx Pro organizer's custom domain shows the same page at its root (src/app/custom-domain/[host]).
 */

export async function generateMetadata({ params }: PageProps<"/o/[id]">): Promise<Metadata> {
  const data = await organizerPage((await params).id);
  if (!data) return { title: "Organizer not found" };
  return organizerMetadata(data, organizerHref(data.organizer.id));
}

export default async function Page({ params }: PageProps<"/o/[id]">) {
  const data = await organizerPage((await params).id);
  if (!data) notFound();
  const session = await getSession();
  if (data.orgId) data.follow = await orgFollowInfo(data.orgId, session?.user.id ?? null, { showCount: true });

  return (
    <PublicPage brand={data.brand}>
      <main className="bg-fx-ivory">
        <OrganizerPage data={data} />
      </main>
    </PublicPage>
  );
}
