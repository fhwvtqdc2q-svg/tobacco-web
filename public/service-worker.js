const CACHE_NAME = "web-platform-tobacco-v507";
// المسارات نسبية لملف الجذر service-worker.js الذي يستورد هذا الملف —
// النطاق الجذري ضروري كي يفتح التطبيق من الكاش حتى لو كان السيرفر المحلي واقفاً.
const ASSETS = [
  "./",
  "index.html",
  "404.html",
  "src/app.js",
  "src/config.js",
  "src/supabase-client.js",
  "src/web-push.js",
  "src/styles.css",
  "src/decision-engine.js",
  "src/decision-engine.css",
  "src/decision-data-bridge.js",
  "src/supplier-obligations-client.js",
  "src/decision-supplier-overlay.js",
  "src/purchase-invoice-calc.js",
  "src/inventory-recon-calc.js",
  "public/manifest.webmanifest",
  "public/icons/app-icon.png",
  "public/icons/ozk-logo.png",
  "public/icons/workspace-pattern.svg",
  "public/vendor/html2pdf.bundle.min.js",
  "public/vendor/supabase.js",
  "public/vendor/xlsx.full.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json?.() || {}; } catch {
    payload = { notification: { body: event.data?.text?.() || "" } };
  }

  const notification = payload.notification || payload;
  const title = String(notification.title || "OZK TOBACCO");
  const navigate = String(notification.navigate || "/?route=overview");
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(notification.body || ""),
      icon: notification.icon || "public/icons/app-icon.png",
      badge: "public/icons/app-icon.png",
      tag: notification.tag || "ozk-alert",
      dir: "rtl",
      lang: "ar",
      data: { navigate }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification?.data?.navigate || "/?route=overview", self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      const existing = list.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await existing.navigate(target);
        return;
      }
      return clients.openWindow(target);
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
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("index.html")))
  );
});
