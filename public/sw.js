/**
 * HF Transport ERP service worker.
 *
 * Goal: the app opens on any device even on a flaky connection, and the last
 * live-tracking view is still visible when the network drops.
 *
 *  - The page (index.html): network-first — the saved copy is only for when there is no connection,
 *    so a new version shows on the very next load (it used to show one load late).
 *  - Assets (hashed JS/CSS/images): stale-while-revalidate (their names change with every build).
 *  - GET /api/tracking/*      : network-first, fall back to the last good copy.
 *  - Everything else /api/*   : network-only (never served stale).
 */
const SHELL_CACHE = "hf-shell-v2"; // v2: the page itself is fetched from the network first (a new deploy shows at once)
const DATA_CACHE = "hf-data-v1";
const SHELL_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // live tracking: network-first with cached fallback
  if (url.pathname.startsWith("/api/tracking/")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then(
            (hit) =>
              hit ||
              new Response(
                JSON.stringify({ error: "offline", offline: true }),
                { status: 503, headers: { "Content-Type": "application/json" } }
              )
          )
        )
    );
    return;
  }

  // other API calls: always live
  if (url.pathname.startsWith("/api/")) return;

  // the page itself: network first, the saved copy only when offline
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("/index.html").then((hit) => hit || caches.match(request)))
    );
    return;
  }

  // app shell / assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
