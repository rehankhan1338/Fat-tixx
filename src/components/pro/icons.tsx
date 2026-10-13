/* Line icons for the Pro page (24px grid, 2px stroke, currentColor). */

import type { ReactNode } from "react";
import type { ProFeatureKey } from "@/lib/home/pro";

function Icon({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const PATHS: Record<ProFeatureKey, ReactNode> = {
  brand: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" />
      <circle cx="7.5" cy="11" r="1.2" />
      <circle cx="10.5" cy="7" r="1.2" />
      <circle cx="15" cy="7.5" r="1.2" />
    </>
  ),
  badge: (
    <>
      <path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  header: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </>
  ),
  domain: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" />
    </>
  ),
  noads: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  seating: (
    <>
      <path d="M6 11V7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v4" />
      <path d="M4 11a2 2 0 0 1 2 2v2h12v-2a2 2 0 1 1 4 0v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" />
      <path d="M6 19v2M18 19v2" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V7M17 16v-7" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6 8.5-6" />
    </>
  ),
  promoters: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  tracking: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  support: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="13" width="4" height="6" rx="1.5" />
      <rect x="17" y="13" width="4" height="6" rx="1.5" />
      <path d="M19 19c0 1.5-1.5 2.5-4 2.5h-2" />
    </>
  ),
};

export function ProFeatureIcon({ k, size }: { k: ProFeatureKey; size?: number }) {
  return <Icon size={size}>{PATHS[k]}</Icon>;
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

