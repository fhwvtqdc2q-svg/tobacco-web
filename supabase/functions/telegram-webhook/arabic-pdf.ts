// ============================================================
// توليد PDF بنص عربي صحيح (بدون مكتبة تشكيل جاهزة)
// المنطق: تشكيل يدوي لحروف العربي (أشكال أول/وسط/آخر/منفرد) حسب
// جدول Unicode Arabic Presentation Forms-B، ثم عكس كل مقطع عربي
// (وعكس ترتيب المقاطع) لإنتاج ترتيب عرض صحيح من اليمين لليسار،
// مع إبقاء الأرقام والفواصل كما هي (بدون عكس) لأنها تُقرأ دائماً
// من اليسار لليمين حتى داخل سطر عربي.
//
// ملاحظة مهمة: هذا أول تنفيذ ولم يُختبر بصرياً (لا نملك عارض PDF
// هنا) — يجب التحقق من الملف الناتج فعلياً بعد أول استخدام.
// ============================================================

type JoinType = "D" | "R" | "U"; // Dual / Right-only / Non-joining

// حرف عادي: أشكاله [isolated, initial, medial, final] (0 يعني لا يوجد شكل بهذا النوع)
const DUAL: Record<string, [string, string, string, string]> = {
  "ئ": ["ﺉ", "ﺋ", "ﺌ", "ﺊ"], // ئ
  "ب": ["ﺏ", "ﺑ", "ﺒ", "ﺐ"], // ب
  "ت": ["ﺕ", "ﺗ", "ﺘ", "ﺖ"], // ت
  "ث": ["ﺙ", "ﺛ", "ﺜ", "ﺚ"], // ث
  "ج": ["ﺝ", "ﺟ", "ﺠ", "ﺞ"], // ج
  "ح": ["ﺡ", "ﺣ", "ﺤ", "ﺢ"], // ح
  "خ": ["ﺥ", "ﺧ", "ﺨ", "ﺦ"], // خ
  "س": ["ﺱ", "ﺳ", "ﺴ", "ﺲ"], // س
  "ش": ["ﺵ", "ﺷ", "ﺸ", "ﺶ"], // ش
  "ص": ["ﺹ", "ﺻ", "ﺼ", "ﺺ"], // ص
  "ض": ["ﺽ", "ﺿ", "ﻀ", "ﺾ"], // ض
  "ط": ["ﻁ", "ﻃ", "ﻄ", "ﻂ"], // ط
  "ظ": ["ﻅ", "ﻇ", "ﻈ", "ﻆ"], // ظ
  "ع": ["ﻉ", "ﻋ", "ﻌ", "ﻊ"], // ع
  "غ": ["ﻍ", "ﻏ", "ﻐ", "ﻎ"], // غ
  "ف": ["ﻑ", "ﻓ", "ﻔ", "ﻒ"], // ف
  "ق": ["ﻕ", "ﻗ", "ﻘ", "ﻖ"], // ق
  "ك": ["ﻙ", "ﻛ", "ﻜ", "ﻚ"], // ك
  "ل": ["ﻝ", "ﻟ", "ﻠ", "ﻞ"], // ل
  "م": ["ﻡ", "ﻣ", "ﻤ", "ﻢ"], // م
  "ن": ["ﻥ", "ﻧ", "ﻨ", "ﻦ"], // ن
  "ه": ["ﻩ", "ﻫ", "ﻬ", "ﻪ"], // ه
  "ي": ["ﻱ", "ﻳ", "ﻴ", "ﻲ"], // ي
};

// حرف يتصل من اليمين فقط: أشكاله [isolated, final]
const RIGHT_ONLY: Record<string, [string, string]> = {
  "آ": ["ﺁ", "ﺂ"], // آ
  "أ": ["ﺃ", "ﺄ"], // أ
  "ؤ": ["ﺅ", "ﺆ"], // ؤ
  "إ": ["ﺇ", "ﺈ"], // إ
  "ا": ["ﺍ", "ﺎ"], // ا
  "ة": ["ﺓ", "ﺔ"], // ة
  "د": ["ﺩ", "ﺪ"], // د
  "ذ": ["ﺫ", "ﺬ"], // ذ
  "ر": ["ﺭ", "ﺮ"], // ر
  "ز": ["ﺯ", "ﺰ"], // ز
  "و": ["ﻭ", "ﻮ"], // و
  "ى": ["ﻯ", "ﻰ"], // ى
};

// لام + ألف (بمختلف صور الألف) = حرف مركّب واحد بشكلين فقط [isolated, final]
const LAM_ALEF: Record<string, [string, string]> = {
  "ا": ["ﻻ", "ﻼ"], // لا
  "أ": ["ﻷ", "ﻸ"], // لأ
  "إ": ["ﻹ", "ﻺ"], // لإ
  "آ": ["ﻵ", "ﻶ"], // لآ
};

const NON_JOINING = new Set(["ء"]); // ء وحدها

function joinType(ch: string): JoinType {
  if (NON_JOINING.has(ch)) return "U";
  if (DUAL[ch]) return "D";
  if (RIGHT_ONLY[ch]) return "R";
  return "U";
}

function isArabicLetter(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x0621 && c <= 0x064A) || c === 0x0671;
}

type Unit = { chars: string; isLigature: boolean; ligKey?: string };

function tokenize(run: string): Unit[] {
  const units: Unit[] = [];
  for (let i = 0; i < run.length; i++) {
    const ch = run[i];
    if (ch === "ل" && i + 1 < run.length && LAM_ALEF[run[i + 1]]) {
      units.push({ chars: ch + run[i + 1], isLigature: true, ligKey: run[i + 1] });
      i++; // تخطّي حرف الألف لأنه اندمج
    } else {
      units.push({ chars: ch, isLigature: false });
    }
  }
  return units;
}

// هل توصل هالوحدة الحرف يلي بعدها؟ (dual-joining فقط يوصل قدام)
function connectsForward(u?: Unit): boolean {
  if (!u || u.chars === " ") return false;
  if (u.isLigature) return false; // لام-ألف يتصرف كحرف R — ما بيوصل قدام أبداً
  return joinType(u.chars) === "D";
}
// هل تقبل هالوحدة اتصالاً من الحرف يلي قبلها؟ (أي حرف موصول عدا ء والمسافة)
function acceptsBackward(u?: Unit): boolean {
  if (!u || u.chars === " ") return false;
  if (u.isLigature) return true;
  return joinType(u.chars) !== "U";
}

// يُشكّل مقطعاً عربياً واحداً (بدون مسافات أو أحرف غير عربية بداخله غير المسافة)
// ويعيده مقلوباً (بترتيب عرض RTL) جاهزاً للرسم من اليسار لليمين
function shapeArabicRun(run: string): string {
  const units = tokenize(run);
  const shaped: string[] = new Array(units.length);

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.chars === " ") { shaped[i] = " "; continue; }

    const prev = units[i - 1];
    const next = units[i + 1];
    // اتصال قبل هالوحدة = الحرف السابق قادر يوصل قدام (dual-joining)
    const connectionBefore = connectsForward(prev);

    if (u.isLigature) {
      const forms = LAM_ALEF[u.ligKey!];
      shaped[i] = connectionBefore ? forms[1] : forms[0]; // final : isolated
      continue;
    }

    const t = joinType(u.chars);
    if (t === "U") { shaped[i] = u.chars; continue; }

    // اتصال بعد هالوحدة = هي نفسها dual-joining، والحرف التالي يقبل اتصالاً من قبله
    const connectionAfter = t === "D" && acceptsBackward(next);

    if (t === "R") {
      const forms = RIGHT_ONLY[u.chars];
      shaped[i] = connectionBefore ? forms[1] : forms[0];
    } else {
      const forms = DUAL[u.chars]; // [isolated, initial, medial, final]
      if (connectionBefore && connectionAfter) shaped[i] = forms[2];
      else if (connectionBefore && !connectionAfter) shaped[i] = forms[3];
      else if (!connectionBefore && connectionAfter) shaped[i] = forms[1];
      else shaped[i] = forms[0];
    }
  }

  return shaped.reverse().join("");
}

// يشكّل سطراً كاملاً (عربي + أرقام + علامات) للرسم المباشر بـ pdf-lib
// النتاج: نص جاهز يُرسم من اليسار لليمين بالترتيب البصري الصحيح.
// ملاحظة: تجنّب استخدام الأقواس () في النصوص المرسومة بهذه الدالة —
// لا تُعكس اتجاهياً هنا (bidi mirroring) وقد تظهر بشكل معكوس.
export function shapeLineForPdf(line: string): string {
  const runs: { arabic: boolean; text: string }[] = [];
  for (const ch of line) {
    const arabic = isArabicLetter(ch) || ch === " ";
    if (runs.length && runs[runs.length - 1].arabic === arabic) {
      runs[runs.length - 1].text += ch;
    } else {
      runs.push({ arabic, text: ch });
    }
  }
  // مسافة منفردة بين مقطعين غير عربيين تبقى كما هي؛ فقط المقاطع العربية (والمسافات
  // الملتصقة بها) تُعامل ككتلة واحدة تُشكَّل وتُعكس معاً.
  const rendered = runs.map((r) => (r.arabic ? shapeArabicRun(r.text) : r.text));
  rendered.reverse();
  return rendered.join("");
}

// ============================================================
// جلب خط عربي (Amiri) وتضمينه بملف PDF — يُنفَّذ مرة واحدة ويُخزَّن بالذاكرة
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
