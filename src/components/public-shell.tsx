import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { brandingForLayout } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";

export async function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const [session, brand] = await Promise.all([getSession(), brandingForLayout()]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className={`mx-auto flex h-14 items-center justify-between px-4 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
          <Link href="/" className="flex items-center gap-2 font-semibold"><BrandMark name={brand.name} logoUrl={brand.logoUrl} size="sm" />{brand.logoUrl ? null : brand.name}</Link>
          <nav className="flex items-center gap-1 text-sm">
            <Button variant="ghost" size="sm" render={<Link href="/tickets/find" />}>Find my tickets</Button>
            {session ? <Button variant="outline" size="sm" render={<Link href={session.user.roles.length ? "/admin" : "/dashboard"} />}>{session.user.roles.length ? "Admin" : "My account"}</Button> : <Button variant="outline" size="sm" render={<Link href="/login" />}>Sign in</Button>}
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-8 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} {brand.name} · All prices shown include mandatory fees. Taxes shown at checkout where applicable.</p>
        <p className="mt-1"><Link href="/terms" className="hover:underline">Terms</Link> · <Link href="/privacy" className="hover:underline">Privacy</Link> · <Link href="/refunds" className="hover:underline">Refund policy</Link> · <Link href="/ticketing-terms" className="hover:underline">Ticketing terms</Link> · <Link href="/organizer-agreement" className="hover:underline">Organizer agreement</Link> · <Link href="/sell" className="hover:underline">Sell tickets</Link> · <a href={`mailto:${brand.supportEmail}`} className="hover:underline">{brand.supportEmail}</a></p>
      </footer>
    </div>
  );
}
