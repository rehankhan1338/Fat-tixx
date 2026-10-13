import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

export const E2E = {
  adminEmail: "e2e-admin@fattixx.local",
  // Must not contain the email's local part ("e2e-admin"): the password policy rejects that.
  adminPassword: "Platform-Test-Passw0rd-2026!",
  /** Origin of the admin console (Fattixx-admin/), where platform staff sign in. */
  adminUrl: (process.env.E2E_ADMIN_URL ?? "http://localhost:3100").replace(/\/+$/, ""),
};

/** The console's sign-in page (its homepage), with or without a query string such as ?next= or ?denied=1. */
export const ADMIN_LOGIN_RE = new RegExp(`^${E2E.adminUrl.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/(\\?.*)?$`);

export function loadEnvLocal() {
  const envFile = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

/** Direct connection to the app database (same credentials the app uses). */
export async function testDb() {
  loadEnvLocal();
  return mysql.createConnection({
    host: process.env.DB_HOST ?? "127.0.0.1", port: Number(process.env.DB_PORT ?? 3307), database: process.env.DB_NAME ?? "fattixx",
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
}

/** Latest emailed link of a kind for an address (the outbox is the source of truth without SMTP). */
export async function latestLinkFor(email: string, pathPart: string): Promise<string | null> {
  const conn = await testDb();
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT text_body FROM email_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 5`, [email.toLowerCase()]);
    for (const r of rows) {
      const m = String(r.text_body).match(new RegExp(`https?://\\S*${pathPart}\\S*`));
      if (m) return m[0];
    }
    return null;
  } finally {
    await conn.end();
  }
}
