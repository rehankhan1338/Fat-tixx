#!/usr/bin/env node
/**
 * Fat Tixx — create (or reset) the Super Admin account from the command line.
 *
 *   npm run admin:create
 *   npm run admin:create -- --email owner@example.com --name "Owner"
 *
 * Deliberately a CLI and not a web page: there is no "first-run setup" route that could be
 * discovered and abused on a fresh deployment. Requires shell access to the server.
 *
 * Password rules enforced here mirror src/lib/security/password.ts:
 *   - 12–128 characters, not identical to the email, no 3+ repeated runs
 *   - not found in the Have I Been Pwned breach corpus (k-anonymity range query)
 *   - hashed with Argon2id (64 MiB, 3 passes)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import mysql from 'mysql2/promise';
import { hash as argonHash, Algorithm } from '@node-rs/argon2';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env.local');

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);

// Plain prompt: a fresh readline interface per question so it never fights the hidden prompt below.
function ask(q) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (answer) => { rl.close(); res(answer); });
  });
}

// Masked prompt: reads raw keystrokes and echoes '*' so the password never appears on screen or in scrollback.
function askHidden(q) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(q);
    const wasRaw = stdin.isRaw === true;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      process.stdout.write('\n');
      resolve(buf);
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return finish();
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }       // Ctrl+C
        if (c === '\u007f' || c === '\b') {                                             // Backspace
          if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (c >= ' ') { buf += c; process.stdout.write('*'); }
      }
    };
    stdin.on('data', onData);
  });
}

const normalizeEmail = (e) => e.trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

function policyErrors(password, email) {
  const errs = [];
  if (password.length < 12) errs.push('at least 12 characters');
  if (password.length > 128) errs.push('at most 128 characters');
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) errs.push('must not contain your email name');
  if (/(.)\1\1\1/.test(password)) errs.push('no character repeated 4+ times in a row');
  if (/^[a-z]+$/i.test(password)) errs.push('use more than only letters');
  return errs;
}

async function pwnedCount(password) {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'FatTixx-Setup' }, signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [suf, count] = line.trim().split(':');
      if (suf === suffix) return Number(count);
    }
    return 0;
  } catch {
    return null; // offline — caller decides
  }
}

const ARGON_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 };

async function main() {
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} in .env.local. Run \`npm run db:setup\` first.`);
    process.exit(1);
  }

  let email = args.email ?? (await ask('Super Admin email: '));
  email = email.trim();
  if (!isEmail(email)) { console.error('Invalid email address.'); process.exit(1); }
  const name = (args.name ?? (await ask('Display name: '))).trim() || 'Super Admin';

  let password;
  for (;;) {
    // Non-interactive use (CI / scripted provisioning): pass the password via an env var, never an argv flag
    // (argv is visible to every process on the machine via the process list).
    password = process.env.FATTIXX_ADMIN_PASSWORD ?? (await askHidden('Password (min 12 chars, hidden): '));
    const errs = policyErrors(password, email);
    if (errs.length) {
      console.log('  Password rejected: ' + errs.join('; '));
      if (process.env.FATTIXX_ADMIN_PASSWORD) process.exit(1);
      continue;
    }
    if (!process.env.FATTIXX_ADMIN_PASSWORD) {
      const confirm = await askHidden('Confirm password: ');
      if (confirm !== password) { console.log('  Passwords do not match.'); continue; }
    }
    process.stdout.write('  Checking against known breached passwords... ');
    const count = await pwnedCount(password);
    if (count === null) console.log('skipped (offline)');
    else if (count > 0) {
      console.log(`REJECTED — seen ${count.toLocaleString()} times in breaches. Choose another.`);
      if (process.env.FATTIXX_ADMIN_PASSWORD) process.exit(1);
      continue;
    }
    else console.log('ok');
    break;
  }


  const passwordHash = await argonHash(password, ARGON_OPTS);
  password = null;

  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });

  const emailNorm = normalizeEmail(email);
  const [existing] = await db.query('SELECT id FROM users WHERE email_normalized = ?', [emailNorm]);

  await db.beginTransaction();
  try {
    let userId;
    if (existing.length) {
      userId = existing[0].id;
      await db.query(
        `UPDATE users SET name = ?, password_hash = ?, password_changed_at = NOW(), status = 'active',
                failed_login_count = 0, locked_until = NULL WHERE id = ?`,
        [name, passwordHash, userId],
      );
      // Password reset invalidates every session.
      await db.query(`UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'password_reset' WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
      console.log(`Updated existing user #${userId} (${email}); all sessions revoked.`);
    } else {
      const [r] = await db.query(
        `INSERT INTO users (public_id, email, email_normalized, name, password_hash, password_changed_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), email, emailNorm, name, passwordHash],
      );
      userId = r.insertId;
      console.log(`Created user #${userId} (${email}).`);
    }
    await db.query(`INSERT IGNORE INTO user_platform_roles (user_id, role, granted_by) VALUES (?, 'super_admin', NULL)`, [userId]);
    await db.query(
      `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
       VALUES (NULL, ?, 'user', ?, JSON_OBJECT('email', ?, 'via', 'cli'))`,
      [existing.length ? 'super_admin.reset_cli' : 'super_admin.created_cli', String(userId), email],
    );
    await db.commit();
  } catch (e) {
    await db.rollback();
    throw e;
  }
  await db.end();

  console.log('\nSuper Admin ready. Next steps:');
  console.log('  1. npm run dev');
  console.log('  2. Open http://localhost:3000/login and sign in.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
