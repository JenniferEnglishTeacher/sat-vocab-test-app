// Service worker: app shell works offline; word banks are cached after the first download.
const SHELL = "sva-shell-20261125g", DATA = "sva-data";
const FILES = ["./", "index.html", "styles.css", "js/config.js", "js/app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith(".bin")) {            // word banks: cache first (the ?v= changes when content changes)
    e.respondWith(caches.open(DATA).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) { (await c.keys()).filter(k => new URL(k.url).pathname === url.pathname).forEach(k => c.delete(k)); c.put(e.request, res.clone()); }
      return res;
    }));
    return;
  }
  e.respondWith(                                   // everything else: newest from the network, cached copy when offline
    fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
