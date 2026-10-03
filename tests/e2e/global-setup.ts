import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadEnvLocal, testDb, E2E } from "./helpers/db";

/**
 * Creates a dedicated Super Admin for the browser tests (idempotent) so the tests never need
 * the owner's real password, and removes leftovers from earlier runs.
 */
export default async function globalSetup() {
  loadEnvLocal();
  const conn = await testDb();
  try {
    await conn.query(`DELETE FROM organizations WHERE slug LIKE 'e2e-%'`);
    await conn.query(`DELETE FROM users WHERE email_normalized LIKE 'e2e-%@fattixx.local' AND email_normalized <> ?`, [E2E.adminEmail]);
  } finally {
    await conn.end();
  }
  execFileSync(process.execPath, [path.resolve(process.cwd(), "scripts/create-super-admin.mjs"), "--email", E2E.adminEmail, "--name", "E2E Admin"], {
    env: { ...process.env, FATTIXX_ADMIN_PASSWORD: E2E.adminPassword },
    stdio: "pipe",
  });
}
