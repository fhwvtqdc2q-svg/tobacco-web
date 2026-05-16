const CACHE_NAME = "web-platform-tobacco-v2";
const ASSETS = [
  "../index.html",
  "../404.html",
  "../src/app.js",
  "../src/config.js",
  "../src/supabase-client.js",
  "../src/styles.css",
  "manifest.webmanifest",
  "icons/app-icon.svg",
  "icons/workspace-pattern.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => caches.match("../index.html"))
    )
  );
});
