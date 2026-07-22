// ملف الجذر: يمنح الـ service worker نطاقاً يغطي الموقع كاملاً (الصفحة الرئيسية وsrc/)
// حتى يفتح التطبيق من الكاش عند انقطاع السيرفر المحلي أو الإنترنت.
// المنطق كله (وCACHE_NAME الذي يرفعه الـ workflow تلقائياً) في public/service-worker.js.
importScripts("public/service-worker.js");
