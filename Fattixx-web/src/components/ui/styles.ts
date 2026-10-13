/* Shared Tailwind styles. cx joins classes without resolving utility conflicts. */

/** Join class names, skipping falsy values */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Centered content column with the page gutter */
export const container = "mx-auto max-w-[1280px] px-(--pad)";

/** Small uppercase label above headings */
export const eyebrow = "text-[12px] font-semibold uppercase tracking-[.14em] text-fx-red/78";

/** Section heading (h2); add size, leading and tracking per use */
export const sectionTitle = "font-display font-semibold";

const btnBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap px-[22px] rounded-full text-[15px] font-semibold border cursor-pointer transition-[background-color,color,border-color,opacity] duration-200";

const btnVariant = {
  /** yellow, the main call to action */
  primary: "border-transparent bg-fx-yellow text-fx-red hover:opacity-88",
  /** solid red */
  red: "border-transparent bg-fx-red text-fx-ivory hover:opacity-88",
  /** outlined */
  outline: "border-fx-red/30 bg-transparent text-fx-red hover:border-fx-red",
};

const btnSize = {
  md: "min-h-[46px]",
  /** compact, e.g. a button inside a pill-shaped input */
  sm: "min-h-[42px]",
};

/** Select size here to avoid conflicting min-height utilities. */
export function button(variant: keyof typeof btnVariant = "primary", size: keyof typeof btnSize = "md"): string {
  return cx(btnBase, btnSize[size], btnVariant[variant]);
}

/** Soft red drop shadow used on white cards and pills */
export const cardShadow = "shadow-[0_18px_40px_-30px_rgba(168,18,26,.45)]";
