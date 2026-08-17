(function () {
  "use strict";

  // إعدادات تجارية غير معتمدة بعد. لا يفعّل المحرك كمية رقمية قبل أن تصبح
  // approved=true وتُعتمد قيم التغطية وحداثة حركة المبيعات صراحةً.
  window.ozkPurchaseBusinessSettings = Object.freeze({
    approved: false,
    targetCoverageDays: null,
    urgentCoverageDays: null,
    salesVelocityFreshnessDays: null,
    minimumOrderUnit: null,
    roundingToUnit2: false
  });
})();
