/* Small stroke icons for the event page (24×24, currentColor). */

import type { ReactNode } from "react";

function Icon({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const CalendarIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const PinIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" />
  </Icon>
);

export const ShareIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
    <path d="M5 12.5V18a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18v-5.5" />
  </Icon>
);

export const PlusIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 12h14" />
  </Icon>
);

export const LockIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Icon>
);

export const DoorIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 5v15.5M3 20.5h18" />
    <path d="M14.5 12.5h.01" />
  </Icon>
);

export const IdIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9" cy="11" r="2.2" />
    <path d="M5.8 16c.6-1.4 1.8-2.2 3.2-2.2s2.6.8 3.2 2.2M15 10h3M15 13.5h3" />
  </Icon>
);

export const RefundIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </Icon>
);

export const TagIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3.5 12.3V4.8a1.3 1.3 0 0 1 1.3-1.3h7.5l8.2 8.2a1.6 1.6 0 0 1 0 2.3l-6.2 6.2a1.6 1.6 0 0 1-2.3 0l-8.5-7.9Z" />
    <circle cx="8.3" cy="8.3" r="1.4" />
  </Icon>
);

export const ChevronDown = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const FlagIcon = ({ size = 15 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Icon>
);

export const CloseIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const ArrowUpRight = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Icon>
);

export const CheckIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
