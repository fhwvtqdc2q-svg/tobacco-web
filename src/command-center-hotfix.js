(function () {
  "use strict";

  let refreshQueued = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 30;

  function cleanUndefined(root) {
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (String(node.nodeValue || "").trim() === "undefined") node.nodeValue = "مركز القيادة";
    }
  }

  function commandVisible() {
    return new URLSearchParams(location.search).get("route") === "command"
      || Boolean(document.querySelector(".command-center"));
  }

  function needsRefresh() {
    const text = document.querySelector("#app")?.textContent || "";
    return text.includes("لم تُحمّل البيانات بعد") || text.includes("جاري تجميع صورة الشركة");
  }

  async function tryRefresh() {
    cleanUndefined(document.body);
    if (!commandVisible() || !needsRefresh()) return;
    if (refreshQueued) return;
    if (!window.ozkCommandCenter?.refresh) {
      if (attempts++ < MAX_ATTEMPTS) setTimeout(tryRefresh, 500);
      return;
    }
    refreshQueued = true;
    try {
      await window.ozkCommandCenter.refresh();
    } catch (error) {
      console.error("[OZK Command Center Hotfix]", error);
    } finally {
      refreshQueued = false;
      if (needsRefresh() && attempts++ < MAX_ATTEMPTS) setTimeout(tryRefresh, 750);
    }
  }

  const observer = new MutationObserver(() => {
    cleanUndefined(document.body);
    if (commandVisible() && needsRefresh()) setTimeout(tryRefresh, 0);
  });

  window.addEventListener("load", () => {
    cleanUndefined(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(tryRefresh, 250);
  });
})();
