import type { Metadata } from "next";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { getBranding, getSettings } from "@/lib/settings";
import { listCategories } from "@/lib/site-content/categories";
import { emailDeliveryStatus } from "@/lib/email";
import { getActiveStripe } from "@/lib/payments/stripe";
import { getEmailSettings, maskBrevoKey } from "@/lib/settings";
import { formatCents } from "@/lib/money";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsForm } from "./settings-form";
import { BrandingForm } from "./branding-form";
import { CategoriesForm } from "./categories-form";
import { EmailSettingsForm } from "./email-form";

export const metadata: Metadata = { title: "Fees & Settings" };

const TABS = ["fees", "branding", "integrations", "categories"] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const sp = await searchParams;
  const [s, brand, stripeActive, categories, email, mail] = await Promise.all([getSettings(), getBranding(), getActiveStripe(), listCategories(), emailDeliveryStatus(), getEmailSettings()]);
  const isSuper = hasPlatformRole(session, "super_admin");
  const tab = TABS.find((t) => t === sp.tab) ?? "fees";
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Fees & settings" description="Platform-wide defaults, branding and event categories. Organizations can be given fee overrides; each event chooses whether the buyer pays fees or the organizer absorbs them." />
      <Tabs defaultValue={tab}>
        <TabsList className="no-scrollbar w-full max-w-full flex-nowrap justify-start overflow-x-auto scroll-px-1 snap-x [&>*]:shrink-0 [&>*]:snap-start sm:w-fit sm:overflow-visible">
          <TabsTrigger value="fees">Fees & checkout</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="categories">Event categories</TabsTrigger>
        </TabsList>
        <TabsContent value="fees" className="pt-4">
          <Section title="Fees, taxes and checkout">
            {isSuper ? <SettingsForm settings={s} /> : (
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Platform fee</dt><dd>{(Number(s.platform_fee_bps) / 100).toFixed(2)}% + {formatCents(Number(s.platform_fee_fixed_cents))} per ticket</dd></div>
                <div><dt className="text-muted-foreground">Processing estimate</dt><dd>{(Number(s.processing_fee_bps) / 100).toFixed(2)}% + {formatCents(Number(s.processing_fee_fixed_cents))} per order</dd></div>
                <div><dt className="text-muted-foreground">Default fee mode</dt><dd>{s.default_fee_mode.replace("_", " ")}</dd></div>
                <div><dt className="text-muted-foreground">Hold time</dt><dd>{s.hold_minutes} minutes</dd></div>
                <p className="text-xs text-muted-foreground sm:col-span-2">Only a Super Admin can change these settings.</p>
              </dl>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="branding" className="pt-4">
          <Section title="Branding" description="Name, logo and accent colour used on the public site, the panels and every email.">
            {isSuper ? <BrandingForm name={brand.name} color={brand.color} supportEmail={brand.supportEmail} logoUrl={uploadUrl(brand.logoPath)} /> : <p className="text-sm text-muted-foreground">Only a Super Admin can change branding.</p>}
          </Section>
        </TabsContent>
        <TabsContent value="integrations" className="pt-4">
          <div className="space-y-6">
            <Section title="Stripe payments" description="Keys, the webhook and the test/live switch are under Payments → Stripe keys.">
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>Card payments</span>{stripeActive ? <Badge variant="outline" className={stripeActive.mode === "live" ? "border-red-500/40 text-red-700" : "border-emerald-500/40 text-emerald-700"}>Connected · {stripeActive.mode.toUpperCase()} mode</Badge> : <Badge variant="outline" className="border-amber-500/40 text-amber-700">Not configured — only free orders work</Badge>}</div>
            </Section>
            <Section title="Email delivery (Brevo)" description="Transactional email for tickets, receipts, invitations and password links. The key is stored encrypted and shared by the public site and this console, so it only has to be entered once.">
              <EmailSettingsForm canEdit={isSuper} maskedKey={email.provider === "brevo" ? maskBrevoKey(mail.apiKey) : null} source={email.source} smtp={email.provider === "smtp"} from={email.from} />
            </Section>
          </div>
        </TabsContent>
        <TabsContent value="categories" className="pt-4">
          <Section title="Event categories" description="Used by the homepage pills, the events filter, the create-event page, the organizer's event form and the mobile app.">
            {isSuper ? <CategoriesForm categories={categories} /> : <p className="text-sm text-muted-foreground">Only a Super Admin can change the event categories.</p>}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
