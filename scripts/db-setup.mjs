#!/usr/bin/env node
/**
 * Fat Tixx — database bootstrap.
 *
 *   npm run db:setup
 *
 * 1. Connects to the local MariaDB/MySQL server as an admin user (XAMPP root by default).
 * 2. Creates the `fattixx` database if missing.
 * 3. Creates a least-privilege application user (`fattixx_app`) with a random password
 *    and writes the credentials to .env.local (never overwrites existing values).
 * 4. Applies every SQL file in db/migrations that has not been applied yet.
 *
 * Idempotent: safe to run again at any time.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.local');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

// ---------- .env.local handling ----------
function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}
function appendEnv(pairs) {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  const prefix = fs.existsSync(ENV_FILE) && fs.readFileSync(ENV_FILE, 'utf8').length && !fs.readFileSync(ENV_FILE, 'utf8').endsWith('\n') ? '\n' : '';
  fs.appendFileSync(ENV_FILE, prefix + lines.join('\n') + '\n');
}

const fileEnv = readEnvFile();
const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d;

const DB_HOST = env('DB_HOST', '127.0.0.1');
const DB_PORT = Number(env('DB_PORT', '3307'));
const DB_NAME = env('DB_NAME', 'fattixx');
const DB_USER = env('DB_USER', 'fattixx_app');
const ADMIN_USER = env('DB_ADMIN_USER', 'root');
const ADMIN_PASSWORD = env('DB_ADMIN_PASSWORD', '');

const toWrite = {};
if (!fileEnv.DB_HOST) toWrite.DB_HOST = DB_HOST;
if (!fileEnv.DB_PORT) toWrite.DB_PORT = String(DB_PORT);
if (!fileEnv.DB_NAME) toWrite.DB_NAME = DB_NAME;
if (!fileEnv.DB_USER) toWrite.DB_USER = DB_USER;

let DB_PASSWORD = env('DB_PASSWORD');
if (!DB_PASSWORD) {
  DB_PASSWORD = crypto.randomBytes(24).toString('base64url');
  toWrite.DB_PASSWORD = DB_PASSWORD;
}
if (!env('APP_URL')) toWrite.APP_URL = 'http://localhost:3000';
if (!env('APP_ENCRYPTION_KEY')) toWrite.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex'); // AES-256-GCM key for secrets stored in the DB (Stripe keys)
if (!env('TICKET_SIGNING_KEY')) toWrite.TICKET_SIGNING_KEY = crypto.randomBytes(32).toString('hex'); // HMAC key for signed QR codes

const log = (...a) => console.log('[db:setup]', ...a);

async function main() {
  log(`connecting to ${DB_HOST}:${DB_PORT} as ${ADMIN_USER}`);
  const admin = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: ADMIN_USER, password: ADMIN_PASSWORD, multipleStatements: true,
  });

  const [[{ version }]] = await admin.query('SELECT VERSION() AS version');
  log(`server version ${version}`);

  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  log(`database \`${DB_NAME}\` ready`);

  // Least-privilege app user: no DDL, no GRANT, scoped to this database only.
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    await admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`, [DB_USER, host, DB_PASSWORD]);
    await admin.query(`ALTER USER ?@? IDENTIFIED BY ?`, [DB_USER, host, DB_PASSWORD]);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO ?@?`, [DB_USER, host]);
  }
  await admin.query('FLUSH PRIVILEGES');
  log(`application user \`${DB_USER}\` ready (SELECT/INSERT/UPDATE/DELETE on \`${DB_NAME}\` only)`);

  // Migrations run as admin because they need DDL rights.
  await admin.changeUser({ database: DB_NAME });
  await admin.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);

  const [appliedRows] = await admin.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        log(`WARNING: ${file} was modified after being applied. Create a new migration instead of editing old ones.`);
      }
      continue;
    }
    log(`applying ${file}`);
    await admin.query(sql);
    await admin.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [file, checksum]);
    count++;
  }
  log(count ? `${count} migration(s) applied` : 'schema already up to date');

  const [tables] = await admin.query('SHOW TABLES');
  log('tables:', tables.map((t) => Object.values(t)[0]).join(', '));
  await admin.end();

  if (Object.keys(toWrite).length) {
    appendEnv(toWrite);
    log(`wrote ${Object.keys(toWrite).join(', ')} to .env.local`);
  }
  log('done. Open http://localhost/phpmyadmin and select the `' + DB_NAME + '` database to inspect the tables.');
}

main().catch((err) => {
  console.error('[db:setup] FAILED:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('Is MySQL running in the XAMPP control panel? Expected it on ' + DB_HOST + ':' + DB_PORT + '.');
  }
  process.exit(1);
});
