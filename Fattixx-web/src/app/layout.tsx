import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { brandingForLayout } from "@/lib/branding";
import { FormValidation } from "@/components/form-validation";
import { display, sans } from "./fonts";
import "./globals.css";

/**
 * Every page is rendered per request. The strict CSP (src/proxy.ts) issues a fresh nonce on each
 * response and Next.js stamps it on its script tags only when the page is rendered dynamically;
 * a statically prerendered page would ship scripts without the nonce and the browser would block them.
 */
export const dynamic = "force-dynamic";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const b = await brandingForLayout();
  return { title: { default: b.name, template: `%s · ${b.name}` }, description: `${b.name} — tickets for live events` };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const b = await brandingForLayout();
  // The accent colour chosen under Admin → Settings → Branding overrides the theme's primary token.
  const brandVars = { "--primary": b.color, "--primary-foreground": b.foreground, "--ring": b.color, "--sidebar-primary": b.color, "--sidebar-primary-foreground": b.foreground } as CSSProperties;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${sans.variable} h-full antialiased`} style={brandVars}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
        <FormValidation />
      </body>
    </html>
  );
}
