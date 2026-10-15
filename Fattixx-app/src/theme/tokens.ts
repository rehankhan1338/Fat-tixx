/**
 * Fattixx design tokens, taken from the website (src/app/globals.css and components/home/styles.ts)
 * so the app looks like the same product: brand red on ivory, yellow calls to action, pill buttons,
 * Bricolage Grotesque display type with IBM Plex Sans body text.
 */
export const colors = {
  red: '#A8121A',
  redDark: '#8E0E15',
  redDeep: '#4E070B',
  redNight: '#6E0A10',
  redSecond: '#C8201A',
  redBright: '#E0241B',
  yellow: '#FFD23F',
  ivory: '#F5F1EA',
  white: '#FFFDFA',
  sand: '#F3ECE2',
  ink: '#2A0A0C',
  pureWhite: '#FFFFFF',

  // neutral panel palette (shadcn tokens on the website's app pages)
  zinc900: '#18181B',
  zinc700: '#3F3F46',
  zinc500: '#71717A',
  zinc300: '#D4D4D8',
  zinc100: '#F4F4F5',
  zinc50: '#FAFAFA',

  // status colours (StatusBadge on the website)
  emerald: '#047857',
  emeraldBg: 'rgba(16,185,129,0.15)',
  amber: '#B45309',
  amberBg: 'rgba(245,158,11,0.15)',
  sky: '#0369A1',
  skyBg: 'rgba(14,165,233,0.15)',
  rose: '#B91C1C',
  roseBg: 'rgba(239,68,68,0.15)',
  slate: '#52525B',
  slateBg: 'rgba(113,113,122,0.15)',
} as const;

/** rgba() of the brand red at a given opacity (the site uses text-fx-red/78, border-fx-red/14 ...). */
export const red = (alpha: number) => `rgba(168,18,26,${alpha})`;
export const ivory = (alpha: number) => `rgba(245,241,234,${alpha})`;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 32 } as const;

/** Page gutter (the site's --pad clamps to 20px on phones). */
export const GUTTER = 20;

export const fonts = {
  display: 'BricolageGrotesque_600SemiBold',
  displayBold: 'BricolageGrotesque_700Bold',
  displayBlack: 'BricolageGrotesque_800ExtraBold',
  sans: 'IBMPlexSans_400Regular',
  sansMedium: 'IBMPlexSans_500Medium',
  sansSemi: 'IBMPlexSans_600SemiBold',
  sansBold: 'IBMPlexSans_700Bold',
} as const;

/** Soft red drop shadow used on white cards and pills (cardShadow on the website). */
export const cardShadow = {
  shadowColor: colors.red,
  shadowOpacity: 0.18,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: 4,
} as const;
