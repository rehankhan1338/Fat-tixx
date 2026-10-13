import type { ReactNode } from "react";
import { PublicPage } from "@/components/layout/PublicPage";

/**
 * Public chrome (floating nav, footer) around pages that keep the application's own components: ticket lookup,
 * checkout, orders, account and the organizer application. `.fx-content` restores the app's font and text colour inside.
 */
export async function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <PublicPage>
      <main className={`fx-content mx-auto w-full flex-1 px-(--pad) pt-[112px] pb-24 max-[901px]:pt-[96px] ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</main>
    </PublicPage>
  );
}
