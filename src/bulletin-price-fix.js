// النشرة تعتمد حصراً آخر أسعار محفوظة على الموقع.
// قبل المعاينة نحفظ أي إدخال ظاهر، نعيد القراءة من Supabase، ثم نربط كل
// مجموعة مدمجة بأحدث سجل سعر تم تعديله على الموقع حتى لا يفوز alias قديم.
(function installBulletinPriceExportFix() {
  if (typeof savePricingItem !== "function" || typeof openPricePreview !== "function") return;

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

  function enforceLatestWebsitePrices(items, useSyria) {
    return (items || []).map((item) => {
      const keys = [item.key, ...(Array.isArray(item.sourceKeys) ? item.sourceKeys : [])];
      const saved = newestSavedPrice(keys);
      if (!saved) return item;
      if (useSyria) {
        const retail = Number(saved?.pricePayload?.retail?.price || 0);
        const factor = typeof itemUnit2Factor === "function" ? itemUnit2Factor({ ...item, approvedPrice: saved }) : Number(item.unit2Factor || 1);
        const rate = Number(state.syriaExchangeRate) || 1;
        return retail > 0 ? { ...item, unit2Price: Math.round((retail / Math.max(1, factor)) * rate) } : item;
      }
      const wholesale = Number(saved?.unit2Price || 0);
      return wholesale > 0 ? { ...item, unit2Price: wholesale } : item;
    });
  }

  const originalPrepareBulletinItems = typeof prepareBulletinItems === "function" ? prepareBulletinItems : null;
  if (originalPrepareBulletinItems) {
    prepareBulletinItems = function prepareBulletinItemsWebsiteAuthoritative(useSyria = false) {
      const prepared = originalPrepareBulletinItems(useSyria);
      if (!prepared) return prepared;
      return { ...prepared, items: enforceLatestWebsitePrices(prepared.items, useSyria) };
    };
  }

  savePendingPricingEdits = async function savePendingPricingEditsFixed() {
    const forms = [...document.querySelectorAll("[data-form='pricing-item']")];
    const pendingForms = forms.filter(formNeedsSave);
    for (const form of pendingForms) {
      const saved = await savePricingItem(form);
      if (!saved) return false;
    }
    if (typeof loadApprovedPriceItems === "function") await loadApprovedPriceItems();
    return true;
  };

  openFreshPricePreview = async function openFreshPricePreviewFixed(useSyria = false) {
    if (!(await savePendingPricingEdits())) return;
    openPricePreview(useSyria);
  };
})();
