import type { NextConfig } from "next";
import os from "node:os";

/** Dev only: every address this machine has on its networks, so a phone on the same Wi-Fi may load dev-server scripts whatever network the PC joins. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Verification builds can use a separate output directory so they never collide with a running `next dev` (same tree).
  ...(process.env.FX_DIST_DIR ? { distDir: process.env.FX_DIST_DIR } : {}),
  // Dev only: lets a phone load the dev server's scripts — same Wi-Fi (this PC's own addresses) or an HTTPS tunnel (needed for the camera).
  allowedDevOrigins: [...lanAddresses(), "*.trycloudflare.com"],
  reactStrictMode: true,
  // next/image qualities used by the public site (the hero photos request 85).
  // Uploaded photos live on Vercel Blob in production (src/lib/uploads.ts).
  images: { qualities: [75, 85], remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }] },
  // The policy pages read content/legal/*.md and Apple Wallet passes content/wallet/*.png at request time; make sure the
  // files ship with the server build.
  outputFileTracingIncludes: { "/terms": ["./content/legal/**"], "/privacy": ["./content/legal/**"], "/t/[code]/wallet/apple": ["./content/wallet/**"] },
  // Native / Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["@node-rs/argon2", "mysql2"],
};

export default nextConfig;
