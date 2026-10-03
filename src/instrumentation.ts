/**
 * In-process scheduler for background jobs (hold expiry, email retries, event reminders, daily
 * Stripe reconciliation). Every minute the server calls its own /api/cron endpoint, so the jobs run
 * in the normal request context. Set JOBS_DISABLED=true when an external cron calls /api/cron instead
 * (for example Vercel Cron, where instances are not long-lived).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.JOBS_DISABLED === 'true') return;
  const g = globalThis as typeof globalThis & { __fxJobs?: ReturnType<typeof setInterval> };
  if (g.__fxJobs) return;
  // Without a configured secret, generate one for this process: only the server itself can call the endpoint.
  // (Web Crypto, not node:crypto: this file is also bundled for the Edge runtime, where it returns early.)
  process.env.CRON_SECRET ||= Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/cron`;
  const tick = async () => {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store' });
      if (!res.ok && res.status !== 404) console.error(`[jobs] /api/cron returned ${res.status}`);
    } catch { /* server not listening yet */ }
  };
  g.__fxJobs = setInterval(tick, 60_000);
  setTimeout(tick, 15_000);
}
