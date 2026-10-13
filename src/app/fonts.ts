import localFont from "next/font/local";

/* Self-hosted variable brand fonts for the public site. Licenses are in src/app/fonts/OFL-*.txt. */

export const display = localFont({
  src: "./fonts/BricolageGrotesque-Variable.woff2",
  weight: "500 800",
  style: "normal",
  display: "swap",
  variable: "--font-bricolage",
  fallback: ["system-ui", "sans-serif"],
});

export const sans = localFont({
  src: "./fonts/IBMPlexSans-Variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-plex",
  fallback: ["system-ui", "-apple-system", "sans-serif"],
});
