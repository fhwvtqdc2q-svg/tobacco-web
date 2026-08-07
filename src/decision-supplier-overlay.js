(function () {
  let paintToken = 0;

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));

  const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  function findSupplierSection() {
    return Array.from(document.querySelectorAll(".decision-section")).find((section) =>
      String(section.querySelector("h2")?.textContent || "").includes("أولوية الموردين")
    ) || null;
  }

  function amountLabel(row) {
    const amount = number(row.amount_due);
    const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (row.currency === "USD") return `${formatted} $`;
    if (row.currency === "SYP") return `${formatted} ل.س`;
    return `${formatted} · عملة أمين`;
  }

  function priorityBadge(row, index) {
    const risk = String(row.supply_risk || "normal").toLowerCase();
    if (risk === "high" || risk === "critical" || index < 2) {
      return '<span class="status-chip decision-danger">أولوية عالية</span>';
    }
    if (risk === "elevated" || index < 5) {
      return '<span class="status-chip decision-warning">مراجعة اليوم</span>';
    }
    return '<span class="status-chip decision-pending">متابعة</span>';
  }

  async function paintSupplierObligations() {
    const token = ++paintToken;
    try {
      if (typeof state !== "undefined" && state?.route !== "decision") return;
      const section = findSupplierSection();
      if (!section) return;
      const source = window.supplierObligationsData;
      if (!source?.listSupplierObligations) return;

      const rows = await source.listSupplierObligations();
      if (token !== paintToken) return;

      const table = section.querySelector("table");
      if (!table) return;
      const thead = table.querySelector("thead");
      const tbody = table.querySelector("tbody");
      if (!thead || !tbody) return;

      thead.innerHTML = "<tr><th>#</th><th>المورد</th><th>الرصيد المستحق</th><th>المصدر</th><th>الأولوية</th></tr>";
      tbody.innerHTML = rows.slice(0, 8).map((row, index) =>
        `<tr><td>${index + 1}</td><td><strong>${escape(row.supplier_name || "مورد")}</strong></td><td dir="ltr">${escape(amountLabel(row))}</td><td>رصيد أمين</td><td>${priorityBadge(row, index)}</td></tr>`
      ).join("") || '<tr><td colspan="5" class="muted">لا يوجد حالياً رصيد موجب مستحق للموردين ضمن بيانات أمين المتزامنة.</td></tr>';

      let note = section.querySelector(".supplier-obligation-source-note");
      if (!note) {
        note = document.createElement("p");
        note.className = "decision-note supplier-obligation-source-note";
        section.appendChild(note);
      }
      note.textContent = "مصدر الرصيد: cu000 في أمين، والحساب الحالي هو Credit - Debit للموردين الذين لديهم فواتير شراء. القيم الموسومة «عملة أمين» لا تُعرض كدولار قبل تثبيت عملة الحساب من أمين.";
    } catch (error) {
      console.error("[OZK Supplier Obligations]", error);
    }
  }

  if (typeof render === "function") {
    const baseRender = render;
    render = function supplierAwareRender(...args) {
      const result = baseRender.apply(this, args);
      setTimeout(paintSupplierObligations, 0);
      return result;
    };
  }

  setTimeout(paintSupplierObligations, 0);
})();
