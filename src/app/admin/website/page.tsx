import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { loadSiteContent } from "@/lib/site-content";
import { listCategories } from "@/lib/site-content/categories";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section } from "@/components/shared";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HomeForm } from "./home-form";
import { PricingForm } from "./pricing-form";
import { FooterForm } from "./footer-form";
import { CategoriesForm } from "./categories-form";

export const metadata: Metadata = { title: "Website" };

const TABS = ["homepage", "pricing", "footer", "categories"] as const;

/** Super Admin: every word, photo, figure and section of the public homepage and pricing page, the shared footer and the event categories. */
export default async function WebsitePage({ searchParams }: PageProps<"/admin/website">) {
  await requirePlatformStaff(["super_admin"]);
  const sp = await searchParams;
  const [content, categories] = await Promise.all([loadSiteContent(), listCategories()]);
  const tab = TABS.find((t) => t === sp.tab) ?? "homepage";
  const preview = tab === "pricing" ? "/pricing" : "/";
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Website"
        description="The public homepage and pricing page, the footer on every public page, and the event categories. Changes go live as soon as they are saved."
        actions={
          <Link href={preview} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
            <ExternalLinkIcon /> Open {tab === "pricing" ? "pricing page" : "homepage"}
          </Link>
        }
      />
      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="homepage">Homepage</TabsTrigger>
          <TabsTrigger value="pricing">Pricing page</TabsTrigger>
          <TabsTrigger value="footer">Footer</TabsTrigger>
          <TabsTrigger value="categories">Event categories</TabsTrigger>
        </TabsList>
        <TabsContent value="homepage" className="pt-4">
          <Section title="Homepage" description="Hero photos and words, the four hosting steps, the event sections and the organizer band. Fee figures are filled in from Fees & Settings.">
            <HomeForm c={content.home} images={{ go: uploadUrl(content.home.hero.go.image), host: uploadUrl(content.home.hero.host.image) }} />
          </Section>
        </TabsContent>
        <TabsContent value="pricing" className="pt-4">
          <Section title="Pricing page" description="Everything around the fee calculator: the rules, the comparison with another platform, the questions and the call to action. The fees themselves are set under Fees & Settings.">
            <PricingForm c={content.pricing} />
          </Section>
        </TabsContent>
        <TabsContent value="footer" className="pt-4">
          <Section title="Footer" description="Shown on every public page.">
            <FooterForm c={content.footer} />
          </Section>
        </TabsContent>
        <TabsContent value="categories" className="pt-4">
          <Section title="Event categories" description="Used by the homepage pills, the events filter, the create-event page and the organizer's event form.">
            <CategoriesForm categories={categories} />
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
