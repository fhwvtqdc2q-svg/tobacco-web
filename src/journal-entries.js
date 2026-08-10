/**
 * Journal Entries (سند القيد)
 *
 * مسودة محاسبية داخلية فقط — بدون مزامنة أو كتابة إلى قاعدة الأمين
 * التخزين: Supabase فقط (جدولا journal_entry_headers و journal_entry_lines)
 * الحساب: محلي بدون أي استدعاء خارجي
 */

class JournalEntry {
  constructor(data = {}) {
    this.id = data.id || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.createdBy = data.createdBy || null;

    // رأس السند
    this.date = data.date || formatTodayIso();
    this.referenceNumber = data.referenceNumber || "";
    this.operationType = data.operationType || "general"; // "general"|"currency_transfer"|"fund_transfer"
    this.description = data.description || "";
    this.notes = data.notes || "";
    this.exchangeRate = Number.isFinite(data.exchangeRate) ? data.exchangeRate : 14500; // 1 USD = X SYP

    // أسطر القيد
    this.lines = (data.lines || []).map(line => ({
      lineNumber: line.lineNumber || 0,
      account: line.account || "",
      currency: ["USD", "SYP"].includes(line.currency) ? line.currency : "USD",
      amount: Number.isFinite(parseFloat(line.amount)) ? parseFloat(line.amount) : 0,
      side: ["debit", "credit"].includes(line.side) ? line.side : "debit",
      valueInUsd: Number.isFinite(parseFloat(line.valueInUsd)) ? parseFloat(line.valueInUsd) : 0,
      lineNote: line.lineNote || ""
    }));
  }

  /**
   * أضف سطراً جديداً للقيد
   */
  addLine(line = {}) {
    this.lines.push({
      lineNumber: this.lines.length + 1,
      account: line.account || "",
      currency: ["USD", "SYP"].includes(line.currency) ? line.currency : "USD",
      amount: Number.isFinite(parseFloat(line.amount)) ? parseFloat(line.amount) : 0,
      side: ["debit", "credit"].includes(line.side) ? line.side : "debit",
      valueInUsd: 0,
      lineNote: line.lineNote || ""
    });
    this.recalculate();
  }

  /**
   * احذف سطراً برقم الفهرس
   */
  removeLine(index) {
    if (index >= 0 && index < this.lines.length) {
      this.lines.splice(index, 1);
      // أعد ترقيم الأسطر
      this.lines.forEach((line, idx) => {
        line.lineNumber = idx + 1;
      });
      this.recalculate();
    }
  }

  /**
   * حدّث سطراً برقم الفهرس
   */
  updateLine(index, updates) {
    if (index >= 0 && index < this.lines.length) {
      const line = this.lines[index];
      if (updates.account !== undefined) line.account = updates.account || "";
      if (updates.currency !== undefined) {
        line.currency = ["USD", "SYP"].includes(updates.currency) ? updates.currency : "USD";
      }
      if (updates.amount !== undefined) {
        line.amount = Number.isFinite(parseFloat(updates.amount)) ? parseFloat(updates.amount) : 0;
      }
      if (updates.side !== undefined) {
        line.side = ["debit", "credit"].includes(updates.side) ? updates.side : "debit";
      }
      if (updates.lineNote !== undefined) line.lineNote = updates.lineNote || "";
      this.recalculate();
    }
  }

  /**
   * أعد حساب القيم بالدولار والتوازن
   * القاعدة:
   * - USD: تبقى كما هي
   * - SYP: تُقسم على سعر الصرف (1 USD = rate SYP)
   */
  recalculate() {
    this.lines.forEach(line => {
      // تجاهل الأسطر بدون حساب أو مبلغ
      if (!line.account || !Number.isFinite(line.amount) || line.amount <= 0) {
        line.valueInUsd = 0;
        return;
      }

      if (line.currency === "USD") {
        // USD يبقى كما هو (مع تقريب 2 عشري)
        line.valueInUsd = roundTo2(line.amount);
      } else if (line.currency === "SYP") {
        // SYP: amount ÷ exchangeRate = valueInUsd
        if (!Number.isFinite(this.exchangeRate) || this.exchangeRate <= 0) {
          line.valueInUsd = 0; // لا يمكن تحويل بدون سعر صحيح
        } else {
          line.valueInUsd = roundTo2(line.amount / this.exchangeRate);
        }
      }

      // ضمان عدم وجود NaN أو Infinity
      if (!Number.isFinite(line.valueInUsd)) {
        line.valueInUsd = 0;
      }
    });
  }

  /**
   * احسب إجمالي المدين والدائن والفرق
   */
  getBalance() {
    let totalDebit = 0;
    let totalCredit = 0;

    this.lines.forEach(line => {
      if (!Number.isFinite(line.valueInUsd) || line.valueInUsd <= 0) return;

      if (line.side === "debit") {
        totalDebit += line.valueInUsd;
      } else if (line.side === "credit") {
        totalCredit += line.valueInUsd;
      }
    });

    // تقريب النتيجة
    totalDebit = roundTo2(totalDebit);
    totalCredit = roundTo2(totalCredit);
    const difference = Math.abs(totalDebit - totalCredit);
    const difference_rounded = roundTo2(difference);

    return {
      totalDebit,
      totalCredit,
      difference: difference_rounded,
      isBalanced: difference_rounded <= 0.01
    };
  }

  /**
   * تحقق من صحة السند قبل الحفظ
   */
  validate() {
    const errors = [];

    // تحقق من عدد الأسطر
    if (!Array.isArray(this.lines) || this.lines.length < 2) {
      errors.push("يجب أن يحتوي السند على سطرين على الأقل");
    }

    // تحقق من صحة الرأس
    if (!Number.isFinite(this.exchangeRate) || this.exchangeRate <= 0) {
      errors.push("سعر الصرف يجب أن يكون رقماً موجباً");
    }

    // تحقق من وجود سطر SYP واحد على الأقل إذا كان هناك SYP
    const hasSyp = this.lines.some(line => line.currency === "SYP");
    if (hasSyp && !Number.isFinite(this.exchangeRate)) {
      errors.push("يجب تحديد سعر صرف عند استخدام العملة السورية");
    }

    // تحقق من كل سطر
    this.lines.forEach((line, i) => {
      if (!line.account || typeof line.account !== "string" || line.account.trim() === "") {
        errors.push(`السطر ${i + 1}: يجب إدخال اسم الحساب`);
      }

      if (!Number.isFinite(line.amount) || line.amount <= 0) {
        errors.push(`السطر ${i + 1}: يجب إدخال مبلغ موجب (أكبر من صفر)`);
      }

      if (!["USD", "SYP"].includes(line.currency)) {
        errors.push(`السطر ${i + 1}: عملة غير معروفة`);
      }

      if (!["debit", "credit"].includes(line.side)) {
        errors.push(`السطر ${i + 1}: جانب غير معروف (مدين/دائن)`);
      }

      if (!Number.isFinite(line.valueInUsd)) {
        errors.push(`السطر ${i + 1}: خطأ في حساب القيمة بالدولار`);
      }
    });

    // تحقق من التوازن
    const balance = this.getBalance();
    if (!balance.isBalanced) {
      errors.push(`السند غير متوازن — الفرق: ${balance.difference.toFixed(2)} USD`);
    }

    // تحقق من أن السند ليس فارغاً من الأساس
    // (0 مدين و 0 دائن = سند غير صالح)
    if (balance.totalDebit === 0 && balance.totalCredit === 0) {
      errors.push("السند فارغ — لا يوجد أي أسطر بقيم حقيقية");
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * حوّل السند إلى JSON للحفظ
   * تحويل صريح: camelCase → snake_case لـ Supabase
   */
  toJSON() {
    return {
      id: this.id,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      created_by: this.createdBy,
      date: this.date,
      reference_number: this.referenceNumber || null,
      operation_type: this.operationType || "general",
      description: this.description || null,
      notes: this.notes || null,
      exchange_rate: this.exchangeRate,
      lines: this.lines.map((line, idx) => ({
        line_number: idx + 1,
        account: line.account,
        currency: line.currency,
        amount: line.amount,
        side: line.side,
        value_in_usd: line.valueInUsd,
        line_note: line.lineNote || null
      }))
    };
  }

  /**
   * أعد بناء السند من JSON (من Supabase)
   * تحويل صريح: snake_case → camelCase
   */
  static fromJSON(data) {
    if (!data) return null;
    return new JournalEntry({
      id: data.id,
      createdAt: data.created_at || data.createdAt,
      updatedAt: data.updated_at || data.updatedAt,
      createdBy: data.created_by || data.createdBy,
      date: data.date,
      referenceNumber: data.reference_number || data.referenceNumber || "",
      operationType: data.operation_type || data.operationType || "general",
      description: data.description || "",
      notes: data.notes || "",
      exchangeRate: data.exchange_rate || data.exchangeRate || 14500,
      lines: (data.lines || []).map(line => ({
        lineNumber: line.line_number || 0,
        account: line.account || "",
        currency: line.currency || "USD",
        amount: parseFloat(line.amount) || 0,
        side: line.side || "debit",
        valueInUsd: parseFloat(line.value_in_usd) || 0,
        lineNote: line.line_note || line.lineNote || ""
      }))
    });
  }

  /**
   * نسخ سند سابق
   */
  static copy(entry) {
    const data = entry.toJSON();
    delete data.id;
    data.created_at = new Date().toISOString();
    data.updated_at = new Date().toISOString();
    data.created_by = null;
    return JournalEntry.fromJSON(data);
  }

  /**
   * تصدير السند كنص عادي (للطباعة)
   */
  toPlainText() {
    const lines = [
      `سند القيد`,
      `${"=".repeat(50)}`,
      `التاريخ: ${this.date}`,
      this.referenceNumber ? `الرقم المرجعي: ${this.referenceNumber}` : "",
      `نوع العملية: ${this.operationType}`,
      `الوصف: ${this.description}`,
      `سعر الصرف: 1 USD = ${this.exchangeRate} SYP`,
      `${"=".repeat(50)}`,
      `الأسطر:`,
      ""
    ].filter(Boolean);

    this.lines.forEach((line, idx) => {
      lines.push(`${idx + 1}. ${line.account} (${line.currency})`);
      lines.push(`   المبلغ: ${line.amount} ${line.currency} = ${line.valueInUsd.toFixed(2)} USD (${line.side})`);
      if (line.lineNote) lines.push(`   ملاحظة: ${line.lineNote}`);
    });

    const balance = this.getBalance();
    lines.push("");
    lines.push(`${"=".repeat(50)}`);
    lines.push(`إجمالي المدين: ${balance.totalDebit.toFixed(2)} USD`);
    lines.push(`إجمالي الدائن: ${balance.totalCredit.toFixed(2)} USD`);
    lines.push(`الفرق: ${balance.difference.toFixed(2)} USD`);
    lines.push(`الحالة: ${balance.isBalanced ? "✓ متوازن" : "✗ غير متوازن"}`);
    lines.push(`${"=".repeat(50)}`);

    if (this.notes) {
      lines.push(`الملاحظات العامة: ${this.notes}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}

/**
 * دالة مساعدة: صيغة التاريخ (YYYY-MM-DD)
 */
function formatTodayIso() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * دالة مساعدة: تقريب إلى عشريات
 */
function roundTo2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
