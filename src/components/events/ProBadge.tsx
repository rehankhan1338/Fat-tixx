/* The check next to a Fattixx Pro organizer's name (event tiles, event pages, organizer pages). See isPro() in lib/events.ts. */

export default function ProBadge({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Fattixx Pro organizer"
      className="shrink-0 text-fx-red-second"
    >
      <title>Fattixx Pro organizer</title>
      <path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}
