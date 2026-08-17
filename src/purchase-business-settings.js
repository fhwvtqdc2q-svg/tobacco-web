(function () {
  "use strict";

  // إعدادات تجارية معتمدة لحساب توصية كمية الشراء.
  window.ozkPurchaseBusinessSettings = Object.freeze({
    approved: true,
    targetCoverageDays: 30,
    urgentCoverageDays: 7,
    salesVelocityFreshnessDays: 3,
    minimumOrderUnit: null,
    roundingToUnit2: true
  });
})();
