#!/usr/bin/env node
/**
 * Gives the admin console (../Fattixx-admin) this folder's dependencies without a second install: creates
 * <repo root>/node_modules as a link to Fattixx-web/node_modules (a directory junction on Windows, a symlink
 * elsewhere). Node, Next.js and TypeScript resolve packages by walking up from the importing file, so files in
 * Fattixx-admin/src find `next`, `react`, `@tailwindcss/postcss` and friends through that link, exactly as they did
 * when the public site lived at the repo root. Anything installed in Fattixx-admin/node_modules itself still wins.
 *
 * Runs on `npm install` here (postinstall); a no-op when the admin folder is absent (for example a deployment of the
 * public site alone) or when the link already exists. Can also be run by hand:  node scripts/link-admin-node-modules.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..');
const root = path.resolve(web, '..');
const admin = path.join(root, 'Fattixx-admin');
const link = path.join(root, 'node_modules');
const target = path.join(web, 'node_modules');

if (!fs.existsSync(admin) || !fs.existsSync(target)) process.exit(0);

let existing = null;
try {
  existing = fs.lstatSync(link);
} catch {}

if (existing) {
  if (existing.isSymbolicLink()) {
    try {
      if (path.resolve(fs.realpathSync(link)) === path.resolve(target)) process.exit(0);
    } catch {}
    fs.unlinkSync(link); // dangling or pointing elsewhere: recreate
  } else if (existing.isDirectory()) {
    const entries = fs.readdirSync(link).filter((e) => e !== '.package-lock.json' && e !== '.bin');
    if (entries.length > 0) {
      console.warn(`[link-admin-node-modules] ${link} is a real directory with packages in it; leaving it alone. ` +
        `Delete it (nothing should be installed at the repo root) and run this script again.`);
      process.exit(0);
    }
    fs.rmSync(link, { recursive: true, force: true });
  } else {
    fs.rmSync(link, { force: true });
  }
}

// The link target is relative (Fattixx-web/node_modules) so it still resolves when the tree is copied somewhere else:
// Vercel packages a deployment's traced files under /var/task, where an absolute /vercel/path0/... link would dangle and
// every require("next/...") in the admin functions would fail. Node turns it into an absolute path for Windows junctions.
fs.symlinkSync(path.relative(path.dirname(link), target), link, 'junction');
console.log(`[link-admin-node-modules] ${link} -> ${target}`);
