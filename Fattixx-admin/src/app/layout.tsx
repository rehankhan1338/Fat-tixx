import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { brandingForLayout } from "@/lib/branding";
import { FormValidation } from "@/components/form-validation";
import { display, sans } from "@/app/fonts";
import "./globals.css";

/**
 * Root layout of the admin console. Mirrors the main app's root layout (src/app/layout.tsx) so the shared pages
 * and components look identical here. Rendered per request: the strict CSP (src/proxy.ts) needs a fresh nonce.
 */
export const dynamic = "force-dynamic";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const b = await brandingForLayout();
  return { title: { default: `${b.name} Admin`, template: `%s · ${b.name} Admin` }, robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const b = await brandingForLayout();
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
