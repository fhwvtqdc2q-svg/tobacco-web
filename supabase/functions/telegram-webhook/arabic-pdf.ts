// ============================================================
// دعم توليد PDF بنص عربي صحيح.
//
// المحاولة الأولى (نسخة سابقة من هذا الملف) كانت تُشكّل الحروف يدوياً
// عبر جدول Unicode Arabic Presentation Forms-B ثم ترسمها. هذا فشل عملياً:
// خط Amiri لا يربط رموز هذا الجدول (FE70-FEFC) بأشكال حروف في جدول
// cmap الخاص فيه، فاختفت معظم الحروف من الملف الناتج.
//
// النسخة الحالية تعتمد بدلاً من ذلك على أن pdf-lib (عبر @pdf-lib/fontkit)
// يستخدم محرك fontkit الداخلي لتخطيط النص (font.layout) عند رسم نص بخط
// مخصّص — وهذا المحرك يقوم فعلياً بربط الحروف العربية ببعضها (initial/
// medial/final) حسب جداول OpenType GSUB الموجودة داخل الخط نفسه، بدل
// الاعتماد على رموز تجميعية جاهزة. لذلك يكفي تمرير النص العربي كما هو
// (بدون أي معالجة يدوية) لدالتي widthOfTextAtSize و drawText بالخط
// المضمّن، ليخرج التشكيل والربط صحيحاً.
//
// ملاحظة: هذا ثاني تنفيذ ولم يُختبر بصرياً بعد (لا نملك عارض PDF هنا) —
// يجب التحقق من الملف الناتج فعلياً.
// ============================================================

const FONT_URLS = [
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf",
  "https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf",
];

let cachedFontBytes: Uint8Array | null = null;
export async function getArabicFontBytes(): Promise<Uint8Array> {
  if (cachedFontBytes) return cachedFontBytes;
  let lastErr: unknown;
  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) { lastErr = new Error(`font_fetch_${res.status}`); continue; }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 10000) { lastErr = new Error("font_too_small"); continue; }
      cachedFontBytes = buf;
      return buf;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`تعذّر تحميل خط PDF العربي: ${String(lastErr)}`);
}
