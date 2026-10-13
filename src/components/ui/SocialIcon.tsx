/* Social network icons (inline SVG, currentColor), shared by the footer and organizer pages. */

import type { ReactNode } from "react";
import type { SocialNetwork } from "@/lib/home/types";

export const SOCIAL_NETWORKS: Record<SocialNetwork, { label: string; icon: ReactNode }> = {
  instagram: {
    label: "Instagram",
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
        <circle cx="12" cy="12" r="3.9" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
      </g>
    ),
  },
  tiktok: {
    label: "TikTok",
    icon: <path fill="currentColor" d="M16.6 3h-3.1v12.1a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.5a5.7 5.7 0 1 0 4.9 5.6V8.9a7.4 7.4 0 0 0 4.3 1.4V7.2A4.3 4.3 0 0 1 16.6 3Z" />,
  },
  facebook: {
    label: "Facebook",
    icon: <path fill="currentColor" d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" />,
  },
  x: {
    label: "X",
    icon: <path fill="currentColor" d="M17.3 3.5h2.9l-6.3 7.2 7.4 9.8h-5.8l-4.5-5.9-5.2 5.9H2.9l6.7-7.7-7.1-9.3h5.9l4.1 5.4 4.8-5.4Zm-1 15.3h1.6L7.8 5.1H6.1l10.2 13.7Z" />,
  },
  youtube: {
    label: "YouTube",
    icon: (
      <path
        fill="currentColor"
        d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.6 2.6 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15.1V8.9l5.2 3.1L10 15.1Z"
      />
    ),
  },
};

export default function SocialIcon({ network, size = 20 }: { network: SocialNetwork; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {SOCIAL_NETWORKS[network].icon}
    </svg>
  );
}
