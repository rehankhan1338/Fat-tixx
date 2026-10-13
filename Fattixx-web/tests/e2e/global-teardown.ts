import { loadEnvLocal, testDb, E2E } from "./helpers/db";

/** Remove everything the browser tests created, including the E2E Super Admin. */
export default async function globalTeardown() {
  if (process.env.E2E_KEEP_DATA) return;
  loadEnvLocal();
  const conn = await testDb();
  try {
    await conn.query(`DELETE FROM ad_campaigns WHERE name LIKE 'e2e-%'`);
    await conn.query(`DELETE FROM organizer_applications WHERE contact_email LIKE 'e2e-%@fattixx.local'`);
    await conn.query(`DELETE FROM organizations WHERE slug LIKE 'e2e-%'`);
    await conn.query(`DELETE FROM users WHERE email_normalized LIKE 'e2e-%@fattixx.local'`);
    await conn.query(`DELETE FROM email_outbox WHERE to_email LIKE 'e2e-%@fattixx.local'`);
    await conn.query(`DELETE FROM login_attempts WHERE email_normalized LIKE 'e2e-%@fattixx.local'`);
  } finally {
    await conn.end();
  }
  void E2E;
}
