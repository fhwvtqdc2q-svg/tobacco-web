const CACHE_NAME = "web-platform-tobacco-v141";
const ASSETS = [
  "../index.html",
  "../404.html",
  "../src/app.js",
  "../src/config.js",
  "../src/supabase-client.js",
  "../src/styles.css",
  "manifest.webmanifest",
  "icons/app-icon.png",
  "icons/ozk-logo.png",
  "icons/workspace-pattern.svg",
  "vendor/html2pdf.bundle.min.js",
  "vendor/supabase.js",
  "vendor/xlsx.full.min.js"
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes("index.html") || c.url === self.registration.scope);
      if (existing) return existing.focus();
      return clients.openWindow(self.registration.scope);
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("../index.html"))
      )
  );
});
