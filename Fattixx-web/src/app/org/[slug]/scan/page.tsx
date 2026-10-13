import type { Metadata } from "next";
import Link from "next/link";
import { ScanLineIcon } from "lucide-react";
import { requireOrg } from "@/lib/authz";
import { listVisibleEvents } from "@/lib/events/queries";
import { formatEventDate } from "@/lib/tz";
import { PageHeader, Section, EmptyState, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";

export const metadata: Metadata = { title: "Check-in" };

export default async function ScanIndexPage({ params }: PageProps<"/org/[slug]/scan">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const events = await listVisibleEvents(ctx, "upcoming");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Check-in" description="Pick the event you are working. The scanner uses this device’s camera; a manual search is always available." />
      <Section>
        {events.length === 0 ? <EmptyState title="No upcoming events" description="Nothing to scan yet." /> : (
          <ItemGroup>
            {events.map((e) => (
              <Item key={e.id} variant="outline">
                <ItemContent className="min-w-0 basis-full sm:basis-auto"><ItemTitle className="line-clamp-none w-full">{e.title} <StatusBadge status={e.status} /></ItemTitle><ItemDescription>{formatEventDate(new Date(e.starts_at), e.timezone)}{e.venue_name ? ` · ${e.venue_name}` : ""} · {e.checked_in}/{e.tickets_sold} checked in</ItemDescription></ItemContent>
                <ItemActions className="w-full sm:w-auto"><Button className="w-full sm:w-auto" render={<Link href={`/org/${slug}/events/${e.id}/scan`} />}><ScanLineIcon /> Open scanner</Button></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Section>
    </div>
  );
}
