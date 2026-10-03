import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: lets a phone load the dev server's scripts — same Wi-Fi (this PC's LAN IP) or an HTTPS tunnel (needed for the camera).
  allowedDevOrigins: ["192.168.1.22", "*.trycloudflare.com"],
  reactStrictMode: true,
  // Native / Node-only packages must not be bundled into the server build.
  serverExternalPackages: ["@node-rs/argon2", "mysql2"],
};

export default nextConfig;
