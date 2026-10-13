/*
 * Fat Tixx scanner service worker (plan 8.2 / 10.3).
 * Only the check-in scanner uses it: the scanner page is cached when it loads online, so a door device
 * can reopen it with no connection. Ticket data itself lives in IndexedDB (see offline-scan-store.ts).
 * Nothing else on the site is served from this cache.
 */
const CACHE = "fx-scanner-v1";
const SCAN_PAGE = /^\/org\/[^/]+\/events\/\d+\/scan\/?$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Scanner page: network first, cached copy when offline.
  if (req.mode === "navigate" && SCAN_PAGE.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
        return res;
      }).catch(() => caches.match(url.pathname).then((r) => r || new Response("Offline and this scanner page was never opened on this device.", { status: 503, headers: { "Content-Type": "text/plain" } }))),
    );
    return;
  }

  // Build assets are content-hashed: cache first, so the scanner's scripts load offline.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});

// Sign-out clears cached scanner pages (they contain attendee names).
self.addEventListener("message", (e) => {
  if (e.data === "fx-clear") e.waitUntil(caches.delete(CACHE));
});
