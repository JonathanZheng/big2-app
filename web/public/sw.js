// Offline support: keeps the app pages, scripts and the model so bots and
// Best move work without a connection. Bump CACHE to drop old files.
const CACHE = "big2-v1";
const PAGES = ["/", "/play", "/friends", "/best-move", "/rules", "/profile"];
const MODEL = ["/model/selfplay_v1.json", "/model/selfplay_v1.bin"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // One missing file must not stop the rest from being cached.
      Promise.all([...PAGES, ...MODEL].map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Files whose names never change: use the cached copy when there is one.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/model/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
    return;
  }

  // Everything else: the network first, then the cache, then the home page.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () =>
        (await caches.match(request)) ||
        (await caches.match(url.pathname)) ||
        (request.mode === "navigate" ? caches.match("/") : Response.error()),
      ),
  );
});
