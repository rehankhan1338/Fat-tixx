import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PublicShell>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Page not found</h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          The page you are looking for doesn&apos;t exist, has moved, or the event is no longer available.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className={buttonVariants({ size: "lg" })}>Back to home</Link>
          <Link href="/events" className={buttonVariants({ size: "lg", variant: "outline" })}>Browse events</Link>
        </div>
      </div>
    </PublicShell>
  );
}
