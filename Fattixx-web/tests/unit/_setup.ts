import fs from "node:fs";
import path from "node:path";

/**
 * Load .env.local (written by `npm run db:setup`) and point the app at the separate
 * `fattixx_test` database so integration tests never touch real data.
 * Create it once with:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
const envFile = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
process.env.DB_NAME = process.env.TEST_DB_NAME ?? "fattixx_test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.TICKET_SIGNING_KEY ??= "test-signing-key-test-signing-key-0123456789";
// Never send real mail or hit Stripe from tests.
delete process.env.SMTP_URL;
delete process.env.BREVO_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
