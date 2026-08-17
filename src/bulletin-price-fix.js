// إصلاح مزامنة أسعار النشرة قبل معاينة/تصدير PDF.
// لا نعتمد فقط على data-dirty لأن بعض المتصفحات/طرق الإدخال قد تترك قيمة
// الحقل مختلفة عن السعر المحفوظ من دون بقاء علامة dirty. قبل التصدير نقارن
// القيم الظاهرة بالسعر الحالي، نحفظ كل اختلاف، ثم نعيد قراءة الأسعار من
// Supabase حتى تُبنى المعاينة من آخر قيمة مؤكدة لا من state قديم.
(function installBulletinPriceExportFix() {
  if (typeof savePricingItem !== "function" || typeof openPricePreview !== "function") return;

  function sameEnteredPrice(left, right) {
    if (typeof samePrice === "function") return samePrice(left, right);
    return Math.abs(Number(left || 0) - Number(right || 0)) <= 0.005;
  }

  function currentSavedPrices(form) {
    const itemKey = form.dataset.itemKey || "";
    const sourceKeys = (() => {
      try { return JSON.parse(form.dataset.sourceKeys || "[]").filter(Boolean); }
      catch { return []; }
    })();
    const wanted = new Set([itemKey, ...sourceKeys].filter(Boolean));
    const saved = (state.approvedPriceItems || []).find((item) => wanted.has(item.itemKey));
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

    // الحقل الفارغ يعني «لم يُدخل سعراً هنا»، وليس طلباً لمسح السعر السابق.
    const wholesaleChanged = wholesaleText !== "" && !sameEnteredPrice(wholesale, saved.wholesale);
    const retailChanged = retailText !== "" && !sameEnteredPrice(retail, saved.retail);
    return wholesaleChanged || retailChanged;
  }

  savePendingPricingEdits = async function savePendingPricingEditsFixed() {
    const forms = [...document.querySelectorAll("[data-form='pricing-item']")];
    const pendingForms = forms.filter(formNeedsSave);

    // نلتقط المراجع أولاً لأن savePricingItem يعيد render بعد كل حفظ.
    for (const form of pendingForms) {
      const saved = await savePricingItem(form);
      if (!saved) return false;
    }

    // مصدر المعاينة النهائي هو القاعدة بعد الحفظ، لا نسخة state سابقة.
    if (typeof loadApprovedPriceItems === "function") {
      await loadApprovedPriceItems();
    }
    return true;
  };

  openFreshPricePreview = async function openFreshPricePreviewFixed(useSyria = false) {
    if (!(await savePendingPricingEdits())) return;
    openPricePreview(useSyria);
  };
})();
