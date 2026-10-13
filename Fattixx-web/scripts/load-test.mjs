#!/usr/bin/env node
/**
 * Load test for on-sale traffic (plan 6.2 / 13.2). Hammers the pages buyers hit during a ticket drop and
 * checks the results against performance targets. Run against staging, never against production.
 *
 *   npm run load-test -- --url http://localhost:3000 --event demo-night-live --concurrency 50 --duration 30
 *
 * Targets (override with flags): p95 ≤ 800 ms and p99 ≤ 2000 ms for pages, error rate ≤ 1 %.
 * Overselling under concurrent checkouts is covered by the automated test
 * tests/unit/checkout.integration.test.ts (parallel holds on limited inventory).
 * Exit code 1 when a target is missed, so it can gate a release.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []));
const base = (args.url ?? 'http://localhost:3000').replace(/\/$/, '');
const concurrency = Number(args.concurrency ?? 25);
const duration = Number(args.duration ?? 20) * 1000;
const target = { p95: Number(args.p95 ?? 800), p99: Number(args.p99 ?? 2000), errors: Number(args.errors ?? 1) };
const paths = ['/', '/api/health', ...(args.event ? [`/events/${args.event}`] : [])];

const results = new Map(paths.map((p) => [p, { times: [], errors: 0, statuses: {} }]));

async function worker(id) {
  const end = Date.now() + duration;
  let i = id;
  while (Date.now() < end) {
    const p = paths[i++ % paths.length];
    const r = results.get(p);
    const t0 = performance.now();
    try {
      const res = await fetch(base + p, { redirect: 'manual', headers: { 'User-Agent': 'fattixx-load-test' } });
      await res.arrayBuffer();
      r.statuses[res.status] = (r.statuses[res.status] ?? 0) + 1;
      if (res.status >= 500) r.errors++;
    } catch { r.errors++; }
    r.times.push(performance.now() - t0);
  }
}

const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

console.log(`Load test: ${base} · ${concurrency} concurrent · ${duration / 1000}s · ${paths.join(', ')}`);
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const secs = (Date.now() - started) / 1000;
let failed = false;
const rows = [];
for (const [p, r] of results) {
  const s = [...r.times].sort((a, b) => a - b);
  const p95 = pct(s, 0.95), p99 = pct(s, 0.99);
  const errRate = s.length ? (r.errors / s.length) * 100 : 100;
  const ok = p95 <= target.p95 && p99 <= target.p99 && errRate <= target.errors;
  if (!ok) failed = true;
  rows.push({ path: p, requests: s.length, 'req/s': (s.length / secs).toFixed(1), p50: pct(s, 0.5).toFixed(0), p95: p95.toFixed(0), p99: p99.toFixed(0), 'errors %': errRate.toFixed(2), statuses: JSON.stringify(r.statuses), result: ok ? 'PASS' : 'FAIL' });
}
console.table(rows);
console.log(`Targets: p95 ≤ ${target.p95} ms, p99 ≤ ${target.p99} ms, errors ≤ ${target.errors} %. ${failed ? 'FAILED' : 'All targets met.'}`);
process.exit(failed ? 1 : 0);
