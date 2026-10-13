import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Verification builds can use a separate output directory so they never collide with a running `next dev` (same tree).
  ...(process.env.FX_DIST_DIR ? { distDir: process.env.FX_DIST_DIR } : {}),
  // Dev only: lets a phone load the dev server's scripts — same Wi-Fi (this PC's LAN IP) or an HTTPS tunnel (needed for the camera).
  allowedDevOrigins: ["192.168.1.22", "*.trycloudflare.com"],
  reactStrictMode: true,
  // next/image qualities used by the public site (the hero photos request 85).
  images: { qualities: [75, 85] },
  // The policy pages read content/legal/*.md at request time; make sure the files ship with the server build.
  outputFileTracingIncludes: { "/terms": ["./content/legal/**"], "/privacy": ["./content/legal/**"] },
  // Native / Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["@node-rs/argon2", "mysql2"],
};

export default nextConfig;
