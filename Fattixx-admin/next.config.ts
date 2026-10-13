import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

/**
 * Fat Tixx admin console (platform staff only).
 *
 * It lives next to the public site (../Fattixx-web) and shares its `src/lib`, `src/components` and `node_modules`
 * (the public site's `npm install` links <repo root>/node_modules to Fattixx-web/node_modules, so packages resolve from here);
 * only the routes differ (see src/app). It runs as its own server (port 3100 in dev) so it can be deployed on its own
 * domain (ADMIN_URL) with its own session cookies: a Super Admin signs in here, never on the public site.
 */
const here = __dirname;
// Repository root: contains Fattixx-web/ (public site, shared code) and this folder.
const root = path.resolve(here, "..");
const web = path.join(root, "Fattixx-web");

// Environment: this folder's own .env files win (Next.js loads them before this file runs); anything missing falls
// back to the public site's, so one .env.local in Fattixx-web/ serves both servers.
for (const file of [".env.local", ".env"]) {
  const p = path.join(web, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

// Tells the shared code it is running inside the console: separate session cookie, staff sessions accepted.
process.env.FX_APP = "admin";
// Background jobs (reminders, payouts, Stripe reconciliation) run inside the public site's server only.
process.env.JOBS_DISABLED = "true";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The repo root's CLAUDE.md already points at the public site's AGENTS.md, which covers this folder.
  agentRules: false,
  // The shared code is outside this folder, so the bundler's root is the repo root.
  turbopack: { root },
  outputFileTracingRoot: root,
  images: { qualities: [75, 85], remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }] },
  // Native / Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["@node-rs/argon2", "mysql2"],
};

export default nextConfig;
