# منصة تطوير مواقع تعمل على Windows وApple

هذا مشروع Web/PWA جاهز كبداية لتطوير مواقع وتطبيقات ويب تعمل على:

- Windows
- iPhone
- iPad
- Mac
- Android

لا يحتاج Xcode أو Mac للتطوير اليومي.

## التشغيل على Windows

```powershell
cd "C:\Users\DELL\Documents\New project\web-platform"
npm run dev
```

افتح:

```text
http://localhost:5173
```

## الفتح على iPhone

1. اجعل الآيفون واللابتوب على نفس شبكة Wi-Fi.
2. في PowerShell شغل:

```powershell
ipconfig
```

3. خذ IPv4 الخاص بـ Wi-Fi.
4. افتح من Safari:

```text
http://YOUR_WINDOWS_IP:5173
```

5. من Safari اختر `Add to Home Screen` لتثبيته كتطبيق ويب.

## تطوير الميزات

- عدل عناصر الخطة والمنصات في `src/config.js`.
- عدل الواجهة والمنطق في `src/app.js`.
- عدل التصميم في `src/styles.css`.

## النشر

يمكن نشره لاحقاً على:

- Vercel
- Netlify
- DigitalOcean
- GitHub Pages بعد تعديل بسيط للمسارات

## الفحص

```powershell
npm run check
```

