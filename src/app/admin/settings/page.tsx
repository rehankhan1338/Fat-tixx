import type { Metadata } from "next";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { getBranding, getSettings } from "@/lib/settings";
import { isSmtpConfigured } from "@/lib/email";
import { getActiveStripe } from "@/lib/payments/stripe";
import { formatCents } from "@/lib/money";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsForm } from "./settings-form";
import { BrandingForm } from "./branding-form";

export const metadata: Metadata = { title: "Fees & Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const sp = await searchParams;
  const [s, brand, stripeActive] = await Promise.all([getSettings(), getBranding(), getActiveStripe()]);
  const isSuper = hasPlatformRole(session, "super_admin");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Fees & settings" description="Platform-wide defaults and branding. Organizations can be given fee overrides; each event chooses whether the buyer pays fees or the organizer absorbs them." />
      <Tabs defaultValue={sp.tab === "branding" ? "branding" : sp.tab === "integrations" ? "integrations" : "fees"}>
        <TabsList><TabsTrigger value="fees">Fees & checkout</TabsTrigger><TabsTrigger value="branding">Branding</TabsTrigger><TabsTrigger value="integrations">Integrations</TabsTrigger></TabsList>
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
          <Section title="Integrations">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between rounded-lg border p-3"><span>Stripe payments <span className="block text-xs text-muted-foreground">Keys and the test/live switch are under <strong>Payments</strong>.</span></span>{stripeActive ? <Badge variant="outline" className={stripeActive.mode === "live" ? "border-red-500/40 text-red-700" : "border-emerald-500/40 text-emerald-700"}>Connected · {stripeActive.mode.toUpperCase()} mode</Badge> : <Badge variant="outline" className="border-amber-500/40 text-amber-700">Not configured — only free orders work</Badge>}</li>
              <li className="flex items-center justify-between rounded-lg border p-3"><span>Email delivery (SMTP) <span className="block text-xs text-muted-foreground">SMTP_URL · MAIL_FROM in .env.local</span></span>{isSmtpConfigured() ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">Connected</Badge> : <Badge variant="outline" className="border-amber-500/40 text-amber-700">Not configured — emails are logged in the outbox</Badge>}</li>
            </ul>
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
