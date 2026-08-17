// النشرة تعتمد حصراً آخر أسعار محفوظة على الموقع.
// نحفظ كل تعديل ظاهر، نعيد القراءة من Supabase، ثم نفتح نفس قالب النشرة الجديدة
// المنشورة. لا نستخدم مولّد PDF الداخلي القديم إطلاقاً.
(function installBulletinPriceExportFix() {
  if (typeof savePricingItem !== "function") return;

  function sameEnteredPrice(left, right) {
    if (typeof samePrice === "function") return samePrice(left, right);
    return Math.abs(Number(left || 0) - Number(right || 0)) <= 0.005;
  }

  function priceTime(row) {
    const value = row?.updatedAt || row?.approvedAt || row?.updated_at || row?.approved_at || row?.createdAt || row?.created_at || "";
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }

  function newestSavedPrice(keys) {
    const wanted = new Set((keys || []).filter(Boolean));
    return (state.approvedPriceItems || [])
      .filter((row) => wanted.has(row.itemKey))
      .sort((a, b) => priceTime(b) - priceTime(a))[0] || null;
  }

  function currentSavedPrices(form) {
    const itemKey = form.dataset.itemKey || "";
    const sourceKeys = (() => {
      try { return JSON.parse(form.dataset.sourceKeys || "[]").filter(Boolean); }
      catch { return []; }
    })();
    const saved = newestSavedPrice([itemKey, ...sourceKeys]);
    return {
      wholesale: Number(saved?.unit2Price || 0),
      retail: Number(saved?.pricePayload?.retail?.price || 0)
    };
  }

  function formNeedsSave(form) {
    if (form.dataset.dirty === "true") return true;
    const saved = currentSavedPrices(form);
    const wholesaleInput = form.querySelector("input[name='wholesalePrice']");
    const retailInput = form.querySelector("input[name='retailPrice']");
    const wholesaleText = String(wholesaleInput?.value || "").trim();
    const retailText = String(retailInput?.value || "").trim();
    const wholesale = typeof toPositivePrice === "function" ? toPositivePrice(wholesaleText) : Number(wholesaleText || 0);
    const retail = typeof toPositivePrice === "function" ? toPositivePrice(retailText) : Number(retailText || 0);
    return (wholesaleText !== "" && !sameEnteredPrice(wholesale, saved.wholesale)) ||
      (retailText !== "" && !sameEnteredPrice(retail, saved.retail));
  }

  savePendingPricingEdits = async function savePendingPricingEditsFixed() {
    const forms = [...document.querySelectorAll("[data-form='pricing-item']")];
    for (const form of forms.filter(formNeedsSave)) {
      const saved = await savePricingItem(form);
      if (!saved) return false;
    }
    if (typeof loadApprovedPriceItems === "function") await loadApprovedPriceItems();
    return true;
  };

  function approvedBulletinUrl(useSyria) {
    const file = useSyria ? "price-list-syp.html" : "price-list-usd.html";
    return `public/downloads/${file}?fresh=${Date.now()}`;
  }

  // هذا الزر كان يفتح customerPricePdfMarkup القديم. الآن صار يفتح نفس التصميم
  // الجديد المستخدم في أزرار اختيار اللون، بعد ضمان حفظ آخر تسعير بالموقع.
  openFreshPricePreview = async function openFreshPricePreviewFixed(useSyria = false) {
    if (!(await savePendingPricingEdits())) return;
    window.open(approvedBulletinUrl(useSyria), "_blank", "noopener,noreferrer");
  };
})();
