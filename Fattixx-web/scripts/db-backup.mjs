#!/usr/bin/env node
/**
 * Fat Tixx database backup with a tested restore (plan 13.1).
 *
 *   npm run db:backup                 → backups/fattixx-YYYYMMDD-HHMMSS.sql.gz (keeps the newest BACKUP_KEEP, default 14)
 *   npm run db:backup -- --verify     → backup, then restore it into a scratch database and compare row counts
 *   npm run db:restore -- <file> [--into <db>]   → restore a backup (default target: a new scratch database; never overwrites without --force)
 *
 * Uses mysqldump / mysql from PATH, or XAMPP's C:\xampp\mysql\bin on Windows (override with MYSQL_BIN).
 * Schedule it daily (Windows Task Scheduler or cron); copy the backups folder off the machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(import.meta.dirname, '..');
const fileEnv = {};
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d;
const DB = { host: env('DB_HOST', '127.0.0.1'), port: Number(env('DB_PORT', '3307')), name: env('DB_NAME', 'fattixx'), user: env('DB_ADMIN_USER', 'root'), password: env('DB_ADMIN_PASSWORD', '') };
const DIR = path.resolve(ROOT, env('BACKUP_DIR', 'backups'));
const KEEP = Number(env('BACKUP_KEEP', '14'));
const log = (...a) => console.log('[db:backup]', ...a);

function bin(name) {
  const dir = env('MYSQL_BIN', process.platform === 'win32' && fs.existsSync('C:\\xampp\\mysql\\bin') ? 'C:\\xampp\\mysql\\bin' : '');
  return dir ? path.join(dir, process.platform === 'win32' ? `${name}.exe` : name) : name;
}
const connArgs = () => [`--host=${DB.host}`, `--port=${DB.port}`, `--user=${DB.user}`, ...(DB.password ? [`--password=${DB.password}`] : [])];

async function backup() {
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(DIR, `${DB.name}-${stamp}.sql.gz`);
  const dump = spawn(bin('mysqldump'), [...connArgs(), '--single-transaction', '--routines', '--triggers', '--hex-blob', '--default-character-set=utf8mb4', DB.name], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  dump.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res, rej) => dump.on('close', (code) => (code === 0 ? res() : rej(new Error(`mysqldump exited ${code}: ${err}`)))));
  await pipeline(dump.stdout, zlib.createGzip({ level: 9 }), fs.createWriteStream(file));
  await done;
  log(`wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  const old = fs.readdirSync(DIR).filter((f) => f.startsWith(`${DB.name}-`) && f.endsWith('.sql.gz')).sort().reverse().slice(KEEP);
  for (const f of old) { fs.unlinkSync(path.join(DIR, f)); log(`pruned ${f}`); }
  return file;
}

async function restore(file, target, { force = false } = {}) {
  const admin = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password });
  try {
    const [rows] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [target]);
    if (rows.length && !force) throw new Error(`Database ${target} exists. Pass --force to overwrite it.`);
    await admin.query(`DROP DATABASE IF EXISTS \`${target}\``);
    await admin.query(`CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally { await admin.end(); }
  const client = spawn(bin('mysql'), [...connArgs(), '--default-character-set=utf8mb4', target], { stdio: ['pipe', 'inherit', 'pipe'] });
  let err = '';
  client.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res, rej) => client.on('close', (code) => (code === 0 ? res() : rej(new Error(`mysql exited ${code}: ${err}`)))));
  await pipeline(fs.createReadStream(file), file.endsWith('.gz') ? zlib.createGunzip() : new (await import('node:stream')).PassThrough(), client.stdin);
  await done;
  log(`restored ${path.basename(file)} into \`${target}\``);
}

async function counts(db) {
  const c = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: db });
  try {
    const [tables] = await c.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = "BASE TABLE" ORDER BY TABLE_NAME', [db]);
    const out = {};
    for (const { t } of tables) { const [[r]] = await c.query(`SELECT COUNT(*) AS n FROM \`${t}\``); out[t] = Number(r.n); }
    return out;
  } finally { await c.end(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (process.argv[1].endsWith('db-restore.mjs') || args[0] === 'restore') {
    const rest = args[0] === 'restore' ? args.slice(1) : args;
    const file = rest.find((a) => !a.startsWith('--') && rest[rest.indexOf(a) - 1] !== '--into');
    if (!file || !fs.existsSync(file)) throw new Error('Usage: npm run db:restore -- <backup.sql.gz> [--into <database>] [--force]');
    const into = rest.includes('--into') ? rest[rest.indexOf('--into') + 1] : `${DB.name}_restored`;
    await restore(path.resolve(file), into, { force: rest.includes('--force') });
    return;
  }
  const file = await backup();
  if (args.includes('--verify')) {
    // A backup only counts once it has been restored: restore into a scratch DB and compare every table.
    const scratch = `${DB.name}_restore_check`;
    const before = await counts(DB.name);
    await restore(file, scratch, { force: true });
    const after = await counts(scratch);
    const diffs = Object.keys(before).filter((t) => before[t] !== after[t] && t !== 'sessions' && t !== 'login_attempts');
    const admin = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password });
    await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``); await admin.end();
    if (diffs.length) { console.error('[db:backup] VERIFY FAILED: row counts differ for', diffs.join(', ')); process.exit(2); }
    log(`verified: ${Object.keys(after).length} tables restored with matching row counts`);
  }
}

main().catch((e) => { console.error('[db:backup]', e.message); process.exit(1); });
