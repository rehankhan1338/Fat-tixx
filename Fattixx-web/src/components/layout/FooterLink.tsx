"use client";

/* Current-page links scroll to the top; section links retain normal navigation. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function FooterLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const pathname = usePathname();
  const here = !href.includes("#") && href.split("?")[0] === pathname;
  return (
    <Link
      href={href}
      className={className}
      aria-current={here ? "page" : undefined}
      onClick={(e) => {
        if (!here) return;
        e.preventDefault();
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      }}
    >
      {children}
    </Link>
  );
}
