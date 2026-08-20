// النشرة تعتمد حصراً آخر أسعار محفوظة على الموقع.
// نحفظ كل تعديل ظاهر ثم نفتح نفس قالب النشرة الجديدة المنشورة.
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
    return (state.approvedPriceItems || []).filter((row) => wanted.has(row.itemKey)).sort((a,b) => priceTime(b)-priceTime(a))[0] || null;
  }
  function currentSavedPrices(form) {
    const itemKey = form.dataset.itemKey || "";
    let sourceKeys = [];
    try { sourceKeys = JSON.parse(form.dataset.sourceKeys || "[]").filter(Boolean); } catch {}
    const saved = newestSavedPrice([itemKey, ...sourceKeys]);
    return { wholesale:Number(saved?.unit2Price||0), retail:Number(saved?.pricePayload?.retail?.price||0) };
  }
  function formNeedsSave(form) {
    if (form.dataset.dirty === "true") return true;
    const saved=currentSavedPrices(form), w=form.querySelector("input[name='wholesalePrice']"), r=form.querySelector("input[name='retailPrice']");
    const wt=String(w?.value||"").trim(), rt=String(r?.value||"").trim();
    const wp=typeof toPositivePrice==="function"?toPositivePrice(wt):Number(wt||0), rp=typeof toPositivePrice==="function"?toPositivePrice(rt):Number(rt||0);
    return (wt!==""&&!sameEnteredPrice(wp,saved.wholesale))||(rt!==""&&!sameEnteredPrice(rp,saved.retail));
  }
  savePendingPricingEdits=async function(){
    for(const form of [...document.querySelectorAll("[data-form='pricing-item']")].filter(formNeedsSave)){ if(!(await savePricingItem(form))) return false; }
    if(typeof loadApprovedPriceItems==="function") await loadApprovedPriceItems();
    return true;
  };
  function selectedSypRate(){
    const candidates=[state?.syriaExchangeRate,state?.exchangeRate,state?.sypRate,document.querySelector("input[name='exchangeRate']")?.value,document.querySelector("input[name='syriaExchangeRate']")?.value,document.querySelector("input[name='sypRate']")?.value];
    for(const value of candidates){ const n=Math.round(Number(String(value??"").replace(/,/g,""))); if(n>0) return n; }
    return 0;
  }
  function approvedBulletinUrl(useSyria){
    if(!useSyria) return `public/downloads/price-list-usd.html?fresh=${Date.now()}`;
    const rate=selectedSypRate();
    if(!rate){ if(typeof setNotice==="function") setNotice("error","حدد سعر صرف صحيح قبل معاينة النشرة السورية."); return ""; }
    return `public/downloads/price-list-syp-${rate}.html?fresh=${Date.now()}`;
  }
  openFreshPricePreview=async function(useSyria=false){
    if(!(await savePendingPricingEdits())) return;
    const url=approvedBulletinUrl(useSyria); if(!url){ if(typeof render==="function") render(); return; }
    window.open(url,"_blank","noopener,noreferrer");
  };
})();
