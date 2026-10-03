/* Small inline SVG icons used across the homepage. */

export function LogoMark() {
  return (
    <svg width="34" height="17" viewBox="0 0 120 60" fill="none" aria-hidden="true">
      <path
        d="M10 10h92a6 6 0 0 1 6 6v8a10 10 0 0 0 0 20v8a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6v-8a10 10 0 0 0 0-20v-8a6 6 0 0 1 6-6z"
        fill="var(--accent)"
      />
      <line x1="84" y1="10" x2="84" y2="50" stroke="var(--dark)" strokeWidth="3" strokeDasharray="5 5" />
    </svg>
  );
}

export function SearchIcon({ size = 18, stroke = 2.2 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function HeartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />
    </svg>
  );
}
