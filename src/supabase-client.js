(function () {
  const SESSION_KEY = "tobacco-session";
  const REQUESTS_KEY = "tobacco-requests";
  const INVENTORY_REPORTS_KEY = "tobacco-inventory-reports";
  const CUSTOMER_LIMITS_KEY = "tobacco-customer-credit-limits";
  const APPROVED_PRICES_KEY = "tobacco-approved-price-items";
  const PURCHASE_INVOICES_KEY = "tobacco-purchase-invoices";
  const RETURNS_KEY = "tobacco-returns";

  const defaultRequests = [
    {
      id: "REQ-1001",
      publicId: "REQ-1001",
      customer: "عميل تجريبي",
      channel: "واتساب",
      type: "استفسار",
      status: "مفتوح",
      note: "طلب متابعة من فريق خدمة العملاء."
    }
  ];

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function cleanText(value, limit) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, limit);
  }

  function parseNumber(value) {
    let text = String(value ?? "")
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٫،]/g, ".")
      .replace(/\s+/g, "")
      .trim();

    const commaCount = (text.match(/,/g) || []).length;
    if (!text.includes(".") && commaCount === 1) {
      const [, decimalPart = ""] = text.split(",");
      if (/^\d{1,2}$/.test(decimalPart)) {
        text = text.replace(",", ".");
      }
    }

    text = text.replace(/,/g, "").replace(/[^\d.-]/g, "");
    const isNegative = text.includes("-");
    text = text.replace(/-/g, "");
    const parts = text.split(".");
    text = `${parts.shift() || ""}${parts.length ? `.${parts.join("")}` : ""}`;
    if (text.startsWith(".")) text = `0${text}`;
    if (isNegative && text) text = `-${text}`;

    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function roundPrice(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return Math.round((number + Number.EPSILON) * 1000) / 1000;
  }

  const config = window.appConfig?.supabase || {};
  const hasConfig = Boolean(config.url && config.publishableKey);
  const hasLibrary = Boolean(window.supabase?.createClient);
  const tableName = config.requestsTable || "customer_requests";
  const inventoryReportsTable = config.inventoryReportsTable || "inventory_reports";
  const creditLimitsTable = config.creditLimitsTable || "customer_credit_limits";
  const approvedPricesTable = config.approvedPricesTable || "approved_price_items";
  const paymentRecordsTable = config.paymentRecordsTable || "payment_records";
  const customerProfilesTable = config.customerProfilesTable || "customer_profiles";
  const itemCostsTable = config.itemCostsTable || "item_costs";
  const dailyMovementTable = config.dailyMovementTable || "daily_movement_reports";
  const purchaseInvoicesTable = config.purchaseInvoicesTable || "purchase_invoices";
  const itemSnapshotTable = config.itemSnapshotTable || "ameen_item_snapshot";
  const purchaseInvoiceReportsTable = config.purchaseInvoiceReportsTable || "ameen_purchase_invoice_reports";
  const returnsTable = config.returnsTable || "returns";
  const client =
    hasConfig && hasLibrary
      ? window.supabase.createClient(config.url, config.publishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        })
      : null;

  function normalizeSession(session) {
    const user = session?.user;
    if (!user) return null;

    const email = (user.email || "").toLowerCase();
    const staffEntry = window.appConfig?.staffRoles?.[email];

    return {
      provider: "supabase",
      id: user.id,
      email: user.email || "",
      name: staffEntry?.name || user.user_metadata?.display_name || user.email || "موظف OZK",
      role: staffEntry?.role || user.user_metadata?.role || "خدمة العملاء"
    };
  }

  function normalizeDbRequest(row) {
    const shortId = String(row.id || Date.now()).slice(0, 8).toUpperCase();
    return {
      id: row.id,
      publicId: `REQ-${shortId}`,
      customer: row.customer,
      channel: row.channel,
      type: row.request_type,
      status: row.status === "closed" ? "مغلق" : "مفتوح",
      note: row.note || "",
      createdAt: row.created_at
    };
  }

  function toDbStatus(status) {
    return status === "مغلق" || status === "closed" ? "closed" : "open";
  }

  function normalizeDbCustomerLimit(row) {
    return {
      id: row.id,
      customerKey: row.customer_key,
      customerName: row.customer_name || "",
      creditLimit: parseNumber(row.credit_limit || 0),
      notes: row.notes || "",
      updatedAt: row.updated_at || row.created_at || ""
    };
  }

  function normalizeCustomerLimitInput(input, userId = null) {
    const creditLimit = parseNumber(input.creditLimit || 0);
    return {
      customer_key: cleanText(input.customerKey, 240),
      customer_name: cleanText(input.customerName, 240),
      credit_limit: Number.isFinite(creditLimit) ? Math.max(0, creditLimit) : 0,
      notes: cleanText(input.notes, 500),
      updated_at: new Date().toISOString(),
      ...(userId ? { updated_by: userId } : {})
    };
  }

  // فواتير المشتريات — تسجيل + مزامنة أمين مستقبلية (لم تُفعَّل بعد، انظر AI_WORK_SYNC.md)
  const PO_STATUS_VALUES = ["draft", "approved", "sync_pending", "synced", "failed"];
  const PO_CURRENCY_VALUES = ["USD", "SYP"];

  function normalizePurchaseItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        item_key: item.item_key == null ? null : String(item.item_key),
        item_number: item.item_number == null ? "" : String(item.item_number),
        item_guid: item.item_guid == null ? null : String(item.item_guid),
        name: cleanText(item.name, 240),
        unit: item.unit === "unit1" ? "unit1" : "unit2",
        qty: Math.max(0, parseNumber(item.qty)),
        price: Math.max(0, parseNumber(item.price))
      }))
      .filter((item) => item.name && item.qty > 0);
  }

  function normalizeDbPurchaseInvoice(row) {
    const shortId = String(row.id || Date.now()).slice(0, 8).toUpperCase();
    const items = normalizePurchaseItems(row.items);
    const status = PO_STATUS_VALUES.includes(row.status) ? row.status : "draft";
    const total = parseNumber(row.total || 0);
    const paidTotal = parseNumber(row.paid_total || 0);
    const remainingTotal = row.remaining_total != null ? parseNumber(row.remaining_total) : roundPrice(total - paidTotal);
    return {
      id: row.id,
      publicId: `PO-${shortId}`,
      supplierName: row.supplier_name || "",
      supplierAmeenGuid: row.supplier_ameen_guid || "",
      supplierAmeenCode: row.supplier_ameen_code || "",
      orderDate: row.order_date || "",
      status,
      items,
      currency: PO_CURRENCY_VALUES.includes(row.currency) ? row.currency : "USD",
      payMethod: row.pay_method === "cash" ? "cash" : "credit",
      paymentAmount: parseNumber(row.payment_amount || 0),
      paymentDate: row.payment_date || "",
      paymentAccount: row.payment_account || "",
      paidTotal,
      remainingTotal,
      idempotencyKey: row.idempotency_key || "",
      syncAttempts: Number(row.sync_attempts || 0),
      syncError: row.sync_error || "",
      ameenDocumentGuid: row.ameen_document_guid || "",
      ameenDocumentNumber: row.ameen_document_number || "",
      syncedAt: row.synced_at || "",
      approvedBy: row.approved_by || "",
      approvedAt: row.approved_at || "",
      correctionCount: Number(row.correction_count || 0),
      correctionLog: Array.isArray(row.correction_log) ? row.correction_log : [],
      total,
      notes: row.notes || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || row.created_at || ""
    };
  }

  // مستندات المرتجعات (مبيعات جملة/مركز، مشتريات) — نفس نمط فواتير المشتريات أعلاه.
  const RET_KIND_VALUES = ["sales_wholesale", "sales_retail", "purchase"];
  const RET_STATUS_VALUES = ["draft", "approved", "sync_pending", "synced", "failed"];
  const RET_PAY_METHOD_VALUES = ["cash", "credit"];

  function normalizeReturnItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        item_key: item.item_key == null ? null : String(item.item_key),
        // مفتاح سطر ثابت/فريد (GUID الفاتورة + مفتاح الصنف + رقم السطر) — أساس
        // مطابقة سقف الكمية المرتجعة، وليس item_key وحده (قد يتكرر بأكثر من سطر).
        line_key: item.line_key == null ? null : String(item.line_key),
        name: cleanText(item.name, 240),
        // الوحدة الأصلية المسجَّلة فعلياً بهذا السطر كما وردت من app.js — نص حر
        // (اسم الوحدة الحقيقي: كروز/كرتونة/شرحة/طرد...)، وليس تحويلاً قسرياً
        // لثنائية "unit1"/"unit2". لا نُسقط أي قيمة حقيقية هنا.
        unit: cleanText(item.unit, 60),
        original_qty: Math.max(0, parseNumber(item.original_qty)),
        qty: Math.max(0, parseNumber(item.qty)),
        price: Math.max(0, parseNumber(item.price)),
        unit_cost: Math.max(0, parseNumber(item.unit_cost || 0))
      }))
      .filter((item) => item.name && item.qty > 0);
  }

  function normalizeDbReturn(row) {
    const shortId = String(row.id || Date.now()).slice(0, 8).toUpperCase();
    const items = normalizeReturnItems(row.items);
    const kindPrefix = row.kind === "purchase" ? "RETP" : row.kind === "sales_retail" ? "RETR" : "RETW";
    return {
      id: row.id,
      publicId: `${kindPrefix}-${shortId}`,
      kind: RET_KIND_VALUES.includes(row.kind) ? row.kind : "sales_wholesale",
      partyName: row.party_name || "",
      partyAmeenGuid: row.party_ameen_guid || "",
      partyAmeenCode: row.party_ameen_code || "",
      originalInvoiceNumber: row.original_invoice_number || "",
      originalInvoiceGuid: row.original_invoice_guid || "",
      originalInvoiceDate: row.original_invoice_date || "",
      originalPayMethod: RET_PAY_METHOD_VALUES.includes(row.original_pay_method) ? row.original_pay_method : "credit",
      treasuryName: row.treasury_name || "",
      reason: row.reason || "",
      items,
      total: parseNumber(row.total || 0),
      status: RET_STATUS_VALUES.includes(row.status) ? row.status : "draft",
      idempotencyKey: row.idempotency_key || "",
      syncAttempts: Number(row.sync_attempts || 0),
      syncError: row.sync_error || "",
      ameenDocumentGuid: row.ameen_document_guid || "",
      ameenDocumentNumber: row.ameen_document_number || "",
      syncedAt: row.synced_at || "",
      approvedBy: row.approved_by || "",
      approvedAt: row.approved_at || "",
      correctionCount: Number(row.correction_count || 0),
      correctionLog: Array.isArray(row.correction_log) ? row.correction_log : [],
      // أثر عكس الربح/التكلفة والتسوية والمخزون بعد الاعتماد — قيم محفوظة فعلياً
      // على المستند نفسه (وليست محسوبة ومهملة فقط)، انظر approveReturnDocument.
      reversedRevenue: parseNumber(row.reversed_revenue || 0),
      reversedCost: parseNumber(row.reversed_cost || 0),
      reversedProfit: parseNumber(row.reversed_profit || 0),
      settlementType: row.settlement_type || "",
      settlementTargetId: row.settlement_target_id || "",
      settlementAmount: parseNumber(row.settlement_amount || 0),
      stockApplied: Boolean(row.stock_applied),
      stockAppliedAt: row.stock_applied_at || "",
      // مفاتيح أسطر (line_key) طُبِّق أثر مخزونها فعلياً بنجاح — تمنع إعادة
      // المحاولة (بعد فشل جزئي) من تطبيق نفس دلتا المخزون على نفس الصنف مرتين.
      stockAppliedItems: Array.isArray(row.stock_applied_items) ? row.stock_applied_items : [],
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || row.created_at || ""
    };
  }

  function normalizeDbItemSnapshot(row) {
    return {
      itemKey: row.item_key || "",
      itemGuid: row.item_guid || "",
      itemNumber: row.item_number == null ? "" : String(row.item_number),
      itemName: row.item_name || "",
      unit1Name: row.unit1_name || "",
      unit2Name: row.unit2_name || "",
      unit2Factor: parseNumber(row.unit2_factor || 1) || 1,
      stockUnit1: row.stock_unit1 != null ? parseNumber(row.stock_unit1) : null,
      lastPurchasePrice: row.last_purchase_price != null ? parseNumber(row.last_purchase_price) : null,
      lastPurchaseDate: row.last_purchase_date || "",
      lastPurchaseCurrency: row.last_purchase_currency || "",
      lastPurchaseUnit: row.last_purchase_unit || "",
      averageCost: row.average_cost != null ? parseNumber(row.average_cost) : null,
      averageCostCurrency: row.average_cost_currency || "",
      averageCostBasis: row.average_cost_basis || "",
      lastSupplierName: row.last_supplier_name || "",
      lastSupplierGuid: row.last_supplier_guid || "",
      movementRank: row.movement_rank != null ? Number(row.movement_rank) : null,
      unitsSold30d: row.units_sold_30d != null ? parseNumber(row.units_sold_30d) : null,
      generatedAt: row.generated_at || ""
    };
  }

  function normalizeDbPaymentRecord(row) {
    return {
      id: row.id,
      customerKey: row.customer_key,
      customerName: row.customer_name || "",
      amount: parseNumber(row.amount || 0),
      paymentDate: row.payment_date || "",
      notes: row.notes || "",
      source: "manual",
      createdAt: row.created_at || ""
    };
  }

  function normalizeDbCustomerProfile(row) {
    return {
      id: row.id,
      customerKey: row.customer_key,
      customerName: row.customer_name || "",
      phone: row.phone || "",
      address: row.address || "",
      notes: row.notes || "",
      updatedAt: row.updated_at || row.created_at || ""
    };
  }

  function normalizeDbApprovedPrice(row) {
    const rawUnit2Factor = parseNumber(row.unit2_factor || 1);
    const unit2Factor = Number.isFinite(rawUnit2Factor) && rawUnit2Factor > 0 ? rawUnit2Factor : 1;
    const rawUnit2Price = parseNumber(row.unit2_price || 0);
    const unit2Price = Number.isFinite(rawUnit2Price) ? Math.max(0, roundPrice(rawUnit2Price)) : 0;
    const fallbackUnit1Price = parseNumber(row.unit1_price || row.sale_price || 0);
    const unit1Price = roundPrice(unit2Price > 0 ? unit2Price / unit2Factor : fallbackUnit1Price);
    return {
      id: row.id,
      itemKey: row.item_key,
      itemName: row.item_name || "",
      itemNumber: row.item_number == null ? "" : String(row.item_number),
      // كود الأمين (mt000.Code) هو ما يقرأه المستخدم على البطاقة؛ itemNumber ترقيم داخلي.
      itemCode: row.item_code == null ? "" : String(row.item_code),
      salePrice: unit1Price,
      stockQty: parseNumber(row.stock_qty || 0),
      stockStatus: row.stock_status || "",
      unit1Name: row.unit1_name || "",
      unit2Name: row.unit2_name || "",
      unit2Factor,
      unit2Price,
      unit1Price,
      sourceReportId: row.source_report_id || "",
      sourceSyncedAt: row.source_synced_at || "",
      pricePayload: row.price_payload || {},
      notes: row.notes || "",
      approvedAt: row.approved_at || row.updated_at || row.created_at || "",
      updatedAt: row.updated_at || row.approved_at || row.created_at || ""
    };
  }

  function normalizeApprovedPriceInput(input, userId = null) {
    const rawUnit2Factor = parseNumber(input.unit2Factor || 1);
    const unit2Factor = Number.isFinite(rawUnit2Factor) && rawUnit2Factor > 0 ? rawUnit2Factor : 1;
    const unit2Price = roundPrice(parseNumber(input.unit2Price || 0));
    const explicitSalePrice = roundPrice(parseNumber(input.salePrice || input.unit1Price || 0));
    const salePrice =
      Number.isFinite(unit2Price) && unit2Price > 0
        ? roundPrice(unit2Price / unit2Factor)
        : explicitSalePrice;
    const stockQty = parseNumber(input.stockQty || 0);
    const cleanSalePrice = Number.isFinite(salePrice) ? Math.max(0, roundPrice(salePrice)) : 0;
    return {
      item_key: cleanText(input.itemKey, 240),
      item_name: cleanText(input.itemName, 240),
      sale_price: cleanSalePrice,
      stock_qty: Number.isFinite(stockQty) ? stockQty : 0,
      stock_status: cleanText(input.stockStatus, 40),
      unit1_name: cleanText(input.unit1Name, 80),
      unit2_name: cleanText(input.unit2Name, 80),
      unit2_factor: unit2Factor,
      unit2_price: Number.isFinite(unit2Price) ? Math.max(0, roundPrice(unit2Price)) : 0,
      unit1_price: cleanSalePrice,
      source_report_id: input.sourceReportId || null,
      source_synced_at: input.sourceSyncedAt || null,
      price_payload: input.pricePayload || {},
      notes: cleanText(input.notes, 500),
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(userId ? { approved_by: userId } : {})
    };
  }

  function missingSessionMessage() {
    return "لا توجد جلسة دخول فعالة. إذا أنشأت الحساب للتو، افتح رسالة التأكيد في البريد أو عطّل تأكيد البريد مؤقتا من Supabase ثم سجل الدخول.";
  }

  function translateAuthError(message) {
    const msg = message || "";
    if (/auth session missing|session.*missing/i.test(msg)) return missingSessionMessage();
    if (/invalid.*credentials|invalid.*password|wrong.*password/i.test(msg)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
    if (/email.*not.*confirmed|email.*unconfirmed/i.test(msg)) return "يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.";
    if (/too many requests|rate.*limit/i.test(msg)) return "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.";
    if (/user.*not.*found|no user/i.test(msg)) return "لا يوجد حساب بهذا البريد الإلكتروني.";
    return msg;
  }

  function translateDbError(message) {
    const msg = message || "";
    if (/pgrst116|no rows/i.test(msg)) return "لم يُعثر على البيانات المطلوبة.";
    if (/pgrst301|jwt.*expired/i.test(msg)) return "انتهت جلسة الدخول. سجّل الدخول مجدداً.";
    if (/pgrst\d+|postgres|relation|column|violates|constraint/i.test(msg)) return "حدث خطأ في قاعدة البيانات. حاول مجدداً أو تواصل مع الدعم.";
    if (/fetch|network|ECONNREFUSED/i.test(msg)) return "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.";
    if (/permission|denied|403|401/i.test(msg)) return "ليس لديك صلاحية لتنفيذ هذه العملية.";
    return msg;
  }

  async function getSupabaseSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(translateDbError(error.message));
    return normalizeSession(data.session);
  }

  async function requireUser() {
    const session = await getSupabaseSession();
    if (!session) throw new Error(missingSessionMessage());

    const { data, error } = await client.auth.getUser();
    if (error) throw new Error(translateAuthError(error.message));
    if (!data.user) throw new Error(missingSessionMessage());
    return data.user;
  }

  // يحدّد كمية المخزون بوحدة1 (الوحدة الأساسية المخزَّنة بـ stock_qty) المقابلة
  // لسطر مرتجع بوحدته الحقيقية المسجَّلة (item.unit)، بمطابقة اسم الوحدة الفعلي
  // أولاً (unit1_name/unit2_name)، وبتراجع توافقي لثنائية "unit1"/"unit2" الحرفية
  // فقط لمستندات قديمة أُنشئت قبل هذا الإصلاح. null صراحة إن تعذّرت المطابقة
  // بثقة — لا نخمّن الوحدة أبداً.
  function returnItemUnit1Delta(priceRow, unitLabel, qty, direction) {
    const sign = direction === "out" ? -1 : 1;
    const unit2Factor = Number(priceRow.unit2_factor) > 0 ? Number(priceRow.unit2_factor) : 1;
    const u1 = String(priceRow.unit1_name || "").trim();
    const u2 = String(priceRow.unit2_name || "").trim();
    const label = String(unitLabel || "").trim();
    if (!label) return null;
    if (u1 && label === u1) return sign * qty;
    if (u2 && label === u2) return sign * qty * unit2Factor;
    if (label === "unit1") return sign * qty;
    if (label === "unit2") return sign * qty * unit2Factor;
    return null;
  }

  // يطبّق أثر مخزون فعلي (كتابة مُثبَّتة، وليست محسوبة فقط) على approved_price_items.stock_qty
  // لسطر مرتجع واحد. يرمي خطأً عربياً صريحاً عند أي غموض (صنف غير موجود، أو تعذّر
  // مطابقة الوحدة بثقة) بدل تخمين النتيجة أو الفشل الصامت — الاستدعاء في
  // approveReturnDocument يجمع هذه الأخطاء في stockWarnings بدل إيقاف الاعتماد كاملاً.
  async function applyReturnStockAdjustment(item, direction) {
    const itemKey = item.item_key != null ? item.item_key : item.itemKey;
    if (!itemKey) throw new Error("لا يوجد مفتاح صنف (item_key) لمطابقة المخزون");
    const qty = Math.max(0, parseNumber(item.qty));
    if (qty <= 0) return;

    if (!client) {
      const all = readJson(APPROVED_PRICES_KEY, []);
      const idx = all.findIndex((row) => String(row.item_key) === String(itemKey));
      if (idx === -1) throw new Error("الصنف غير موجود في قائمة الأسعار المعتمدة");
      const row = all[idx];
      const delta = returnItemUnit1Delta(row, item.unit, qty, direction);
      if (delta == null) throw new Error("تعذّر تحديد وحدة الصنف بثقة");
      row.stock_qty = Math.max(0, roundPrice(Number(row.stock_qty || 0) + delta));
      all[idx] = row;
      writeJson(APPROVED_PRICES_KEY, all);
      return;
    }

    const { data, error } = await client
      .from(approvedPricesTable)
      .select("id, item_key, stock_qty, unit1_name, unit2_name, unit2_factor")
      .eq("item_key", itemKey)
      .limit(1);
    if (error) throw new Error(translateDbError(error.message));
    const row = data?.[0];
    if (!row) throw new Error("الصنف غير موجود في approved_price_items");
    const delta = returnItemUnit1Delta(row, item.unit, qty, direction);
    if (delta == null) throw new Error("تعذّر تحديد وحدة الصنف بثقة");
    const newStock = Math.max(0, roundPrice(Number(row.stock_qty || 0) + delta));
    const { error: updErr } = await client.from(approvedPricesTable).update({ stock_qty: newStock }).eq("id", row.id);
    if (updErr) throw new Error(translateDbError(updErr.message));
  }

  // تطبيق أثر المخزون فعلياً على approved_price_items.stock_qty لمستند معتمَد
  // مسبقاً — دالة منفصلة عن approveReturnDocument عمداً كي تُستدعى وحدها عند
  // إعادة المحاولة (انظر approveReturnDocument أدناه لسبب الفصل). كل صنف نجح
  // تطبيقه سابقاً (موجود في alreadyAppliedItems) يُتجاوز، فلا تُضاعَف دلتا
  // المخزون على إعادة المحاولة (نقطة الضعف التي رُصدت في مراجعة PR #37).
  async function applyReturnStockForDoc(id, doc, alreadyAppliedItems) {
    const items = Array.isArray(doc.items) ? doc.items : [];
    const direction = retCalc.retInventoryDirection(doc.kind);
    const done = new Set(Array.isArray(alreadyAppliedItems) ? alreadyAppliedItems : []);
    const stockWarnings = [];
    for (const item of items) {
      const itemKey = item.lineKey || item.line_key || item.itemKey || item.item_key || item.name;
      if (done.has(itemKey)) continue;
      try {
        await applyReturnStockAdjustment(item, direction);
        done.add(itemKey);
      } catch (err) {
        stockWarnings.push(`${item.name || item.itemKey || item.item_key || "صنف"}: ${err?.message || err}`);
      }
    }
    const stockPatch = {
      stock_applied: done.size >= items.length,
      stock_applied_items: Array.from(done),
      stock_applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (!client) {
      const all = readJson(RETURNS_KEY, []).map((row) => (row.id === id ? { ...row, ...stockPatch } : row));
      writeJson(RETURNS_KEY, all);
      return { stockWarnings };
    }
    const { error } = await client.from(returnsTable).update(stockPatch).eq("id", id);
    if (error) throw new Error(translateDbError(error.message));
    return { stockWarnings };
  }

  const service = {
    mode: client ? "supabase" : "local",
    hasConfig,
    hasLibrary,
    defaultRequests,

    isConfigured() {
      return Boolean(client);
    },

    statusLabel() {
      if (client) return "متصل بقاعدة Supabase";
      if (hasConfig && !hasLibrary) return "مفاتيح Supabase موجودة لكن المكتبة لم تتحمل";
      return "وضع تجريبي محلي";
    },

    async getSession() {
      if (client) return getSupabaseSession();
      return readJson(SESSION_KEY, null);
    },

    async signIn(input) {
      if (!client) {
        const session = {
          provider: "local",
          name: cleanText(input.name, 80) || "موظف OZK",
          role: cleanText(input.role, 40) || "خدمة العملاء"
        };
        writeJson(SESSION_KEY, session);
        return { session };
      }

      const email = cleanText(input.email, 160);
      const password = String(input.password || "");
      if (!email || !password) throw new Error("اكتب البريد وكلمة المرور.");

      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(translateAuthError(error.message));

      const session = normalizeSession(data.session);
      if (!session) throw new Error(missingSessionMessage());
      return { session };
    },

    async signUp(input) {
      if (!client) return this.signIn(input);

      const email = cleanText(input.email, 160);
      const password = String(input.password || "");
      if (!email || !password) throw new Error("اكتب البريد وكلمة المرور.");
      if (password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: cleanText(input.name, 80),
            role: cleanText(input.role, 40) || "خدمة العملاء"
          }
        }
      });
      if (error) throw new Error(translateDbError(error.message));

      return {
        session: normalizeSession(data.session),
        needsEmailConfirmation: !data.session
      };
    },

    async signOut() {
      if (client) {
        const { error } = await client.auth.signOut();
        if (error) throw new Error(translateDbError(error.message));
      }
      writeJson(SESSION_KEY, null);
    },

    async listRequests() {
      if (!client) return readJson(REQUESTS_KEY, defaultRequests);

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(tableName)
        .select("id, customer, channel, request_type, status, note, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new Error(translateDbError(error.message));
      return data.map(normalizeDbRequest);
    },

    async createRequest(input) {
      const request = {
        id: `REQ-${Date.now().toString().slice(-5)}`,
        publicId: `REQ-${Date.now().toString().slice(-5)}`,
        customer: cleanText(input.customer, 120) || "عميل جديد",
        channel: cleanText(input.channel, 40) || "ويب",
        type: cleanText(input.type, 60) || "طلب خدمة",
        status: "مفتوح",
        note: cleanText(input.note, 1000) || "لا توجد ملاحظات"
      };

      if (!client) {
        const requests = [request, ...readJson(REQUESTS_KEY, defaultRequests)];
        writeJson(REQUESTS_KEY, requests);
        return request;
      }

      const user = await requireUser();
      const { data, error } = await client
        .from(tableName)
        .insert({
          customer: request.customer,
          channel: request.channel,
          request_type: request.type,
          status: "open",
          note: request.note,
          created_by: user.id
        })
        .select("id, customer, channel, request_type, status, note, created_at, updated_at")
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return data?.[0] ? normalizeDbRequest(data[0]) : request;
    },

    async updateRequestStatus(id, status) {
      if (!client) {
        const requests = readJson(REQUESTS_KEY, defaultRequests).map((request) =>
          request.id === id ? { ...request, status } : request
        );
        writeJson(REQUESTS_KEY, requests);
        return;
      }

      await requireUser();
      const { error } = await client
        .from(tableName)
        .update({ status: toDbStatus(status), updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw new Error(translateDbError(error.message));
    },

    // تفاصيل الصنف (تكلفة + توزيع المستودعات) يرفعها tools/push-item-details.ps1.
    // جلب مستقل لأن listInventoryReports محدود بآخر 12 تقريراً وتقارير المزامنة
    // المتكررة كل 5 دقائق تزيح هذا التقرير خارجها.
    async getLatestItemDetailsReport() {
      if (!client) return null;
      const session = await getSupabaseSession();
      if (!session) return null;
      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("summary, items, created_at")
        .eq("source", "ameen_item_details")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null; // ميزة عرض فقط — لا تُفشل تحميل الصفحة
      return data || null;
    },

    async listInventoryReports() {
      if (!client) {
        return readJson(INVENTORY_REPORTS_KEY, []).filter((report) => !["ameen_customer_balances", "ameen_customer_movements", "ameen_customer_invoices", "ameen_expenses"].includes(report.source));
      }

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .not("source", "in", '("ameen_customer_balances","ameen_customer_movements","ameen_customer_invoices","ameen_expenses")')
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) throw new Error(translateDbError(error.message));
      return data || [];
    },

    async listItemCosts() {
      // التكلفة محمية على مستوى القاعدة (RLS = is_owner). غير المدير يرجع له [] دائماً.
      if (!client) return [];
      const session = await getSupabaseSession();
      if (!session) return [];
      try {
        const { data, error } = await client
          .from(itemCostsTable)
          .select("item_guid, item_name, avg_cost, currency, updated_at");
        if (error) return [];
        return data || [];
      } catch {
        return [];
      }
    },

    async getCustomerMovementsReport() {
      if (!client) {
        const local = readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source === "ameen_customer_movements");
        return local[0] || null;
      }

      const session = await getSupabaseSession();
      if (!session) return null;

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .eq("source", "ameen_customer_movements")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return (data && data[0]) || null;
    },

    async getCustomerInvoicesReport() {
      // فواتير المبيعات لكل زبون مع محتوياتها (يكتبها push-customer-invoices.ps1). للموظفين فقط.
      if (!client) {
        const local = readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source === "ameen_customer_invoices");
        return local[0] || null;
      }

      const session = await getSupabaseSession();
      if (!session) return null;

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .eq("source", "ameen_customer_invoices")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return (data && data[0]) || null;
    },

    async getPurchaseInvoicesAmeenReport() {
      // فواتير المشتريات الحقيقية من الأمين لكل مورد مع محتوياتها (يكتبها
      // pull-purchase-invoices-from-ameen.ps1). قراءة فقط، من جدول مستقل محمي
      // (ameen_purchase_invoice_reports) وليس inventory_reports العام — البيانات
      // حساسة (موردون/أسعار/تكاليف/دفعات) ومحصورة بـRLS للمالك فقط. لا علاقة
      // بجدول purchase_invoices اليدوي (مسودة/معتمدة/مزامنة).
      if (!client) {
        const local = readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source === "ameen_purchase_invoices");
        return local[0] || null;
      }

      const session = await getSupabaseSession();
      if (!session) return null;

      const { data, error } = await client
        .from(purchaseInvoiceReportsTable)
        .select("id, report_date, summary, items, created_at")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return (data && data[0]) || null;
    },

    async getInvoiceSeriesReport() {
      // آخر رقم فاتورة لكل سلسلة ترقيم في الأمين (يكتبها push-invoice-series.ps1).
      // مصدر مستقل عن ameen_customer_invoices لأن ذاك يُسقِط الفواتير بلا اسم زبون
      // ولا يحمل نوع الفاتورة، فلا يصلح لمعرفة آخر رقم فعلي في كل سلسلة.
      if (!client) {
        const local = readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source === "ameen_invoice_series");
        return local[0] || null;
      }

      const session = await getSupabaseSession();
      if (!session) return null;

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .eq("source", "ameen_invoice_series")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return (data && data[0]) || null;
    },

    async getDailyMovementReport(date) {
      // تقرير ملخص الحركة اليومية ليوم محدد (أحدث نسخة لذلك اليوم). يحتاج جلسة.
      if (!client) return null;
      const session = await getSupabaseSession();
      if (!session) return null;

      let query = client
        .from(dailyMovementTable)
        .select("id, report_date, payload, created_at")
        .order("report_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      if (date) query = query.eq("report_date", date);

      const { data, error } = await query;
      if (error) throw new Error(translateDbError(error.message));
      return (data && data[0]) || null;
    },

    async listCustomerBalanceReports() {
      if (!client) {
        return readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source === "ameen_customer_balances");
      }

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .eq("source", "ameen_customer_balances")
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) throw new Error(translateDbError(error.message));
      return data || [];
    },

    async listCustomerWhatsapp() {
      if (!client) return [];
      const session = await getSupabaseSession();
      if (!session) return [];
      const { data, error } = await client
        .from("customer_whatsapp")
        .select("customer_guid, customer_name, phone_number, region, customer_type, currency");
      if (error) return [];
      return data || [];
    },

    async createSharedDocument(doc) {
      if (!client) throw new Error("غير متصل بقاعدة البيانات.");
      const session = await getSupabaseSession();
      if (!session) throw new Error(missingSessionMessage());
      const { data, error } = await client
        .from("shared_documents")
        .insert({ doc })
        .select("id, public_token")
        .single();
      if (error) throw new Error(translateDbError(error.message));
      // public_token هو رمز المشاركة المعتمد (UUID كامل). id يبقى مفتاحاً داخلياً
      // ولا يصلح رمزاً للمشاركة: 10 خانات hex أي 40 بت فقط. أي رابط وصل يُبنى
      // مستقبلاً يستعمل ‎receipt.html?t=<public_token>‎ لا ‎?id=‎.
      return { id: data.id, token: data.public_token, publicUrl: `receipt.html?t=${data.public_token}` };
    },

    async listCustomerCreditLimits() {
      if (!client) return readJson(CUSTOMER_LIMITS_KEY, []);

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(creditLimitsTable)
        .select("id, customer_key, customer_name, credit_limit, notes, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1000);

      if (error) throw new Error(translateDbError(error.message));
      return (data || []).map(normalizeDbCustomerLimit);
    },

    async upsertCustomerCreditLimit(input) {
      const payload = normalizeCustomerLimitInput(input);
      if (!payload.customer_key) throw new Error("لا يمكن حفظ حد زبون بدون مفتاح مطابق.");

      if (!client) {
        const current = readJson(CUSTOMER_LIMITS_KEY, []);
        const limit = {
          id: payload.customer_key,
          customerKey: payload.customer_key,
          customerName: payload.customer_name,
          creditLimit: payload.credit_limit,
          notes: payload.notes,
          updatedAt: payload.updated_at
        };
        const next = [limit, ...current.filter((item) => item.customerKey !== payload.customer_key)];
        writeJson(CUSTOMER_LIMITS_KEY, next);
        return limit;
      }

      const user = await requireUser();
      const { data, error } = await client
        .from(creditLimitsTable)
        .upsert(normalizeCustomerLimitInput(input, user.id), { onConflict: "customer_key" })
        .select("id, customer_key, customer_name, credit_limit, notes, created_at, updated_at")
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return data?.[0] ? normalizeDbCustomerLimit(data[0]) : normalizeDbCustomerLimit(payload);
    },

    async listApprovedPriceItems() {
      if (!client) return readJson(APPROVED_PRICES_KEY, []);

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(approvedPricesTable)
        .select("id, item_key, item_name, item_number, item_code, sale_price, stock_qty, stock_status, unit1_name, unit2_name, unit2_factor, unit2_price, unit1_price, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at")
        .order("item_name", { ascending: true })
        .limit(5000);

      if (error) throw new Error(translateDbError(error.message));
      return (data || []).map(normalizeDbApprovedPrice);
    },

    async upsertApprovedPriceItems(items) {
      const payload = (items || [])
        .map((item) => normalizeApprovedPriceInput(item))
        .filter((item) => item.item_key && item.item_name && item.sale_price > 0);

      if (!payload.length) {
        throw new Error("لا توجد أسعار صالحة للحفظ.");
      }

      if (!client) {
        const normalized = payload.map((item) =>
          normalizeDbApprovedPrice({
            ...item,
            id: item.item_key,
            created_at: item.approved_at
          })
        );
        writeJson(APPROVED_PRICES_KEY, normalized);
        return normalized;
      }

      const user = await requireUser();

      // احفظ أرقام وأكواد الأصناف الحالية كي لا يمسحها الـ upsert.
      // بيانات الموقع لا تحمل أرقام الأمين، فنُعيد ربطها من الصفوف الحالية عبر item_key.
      let numberByKey = null; // null = تعذّر الجلب → لا نلمس item_number/item_code (نفس السلوك السابق)
      let codeByKey = null;
      try {
        const { data: existingRows, error: fetchErr } = await client
          .from(approvedPricesTable)
          .select("item_key, item_number, item_code")
          .limit(5000);
        if (!fetchErr) {
          numberByKey = {};
          codeByKey = {};
          for (const row of existingRows || []) {
            if (!row || !row.item_key) continue;
            if (row.item_number != null && String(row.item_number) !== "") {
              numberByKey[row.item_key] = row.item_number;
            }
            if (row.item_code != null && String(row.item_code) !== "") {
              codeByKey[row.item_key] = row.item_code;
            }
          }
        }
      } catch (_) { numberByKey = null; codeByKey = null; }

      const withUser = (items || [])
        .map((item) => normalizeApprovedPriceInput(item, user.id))
        .filter((item) => item.item_key && item.item_name && item.sale_price > 0)
        .map((rec) =>
          numberByKey
            ? { ...rec, item_number: numberByKey[rec.item_key] ?? null, item_code: codeByKey[rec.item_key] ?? null }
            : rec
        );
      const { data, error } = await client
        .from(approvedPricesTable)
        .upsert(withUser, { onConflict: "item_key" })
        // item_number وitem_code إلزاميان في الراجع: المتصل يستبدل الصنف في الذاكرة
        // بالكائن الراجع (app.js: priceMap.set)، فغيابهما يُفرغ الرقمين حتى إعادة
        // تحميل الصفحة فيتوقف البحث بالكود وبالرقم الداخلي (مانع رصدته المراجعة).
        .select("id, item_key, item_name, item_number, item_code, sale_price, stock_qty, stock_status, unit1_name, unit2_name, unit2_factor, unit2_price, unit1_price, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at");

      if (error) throw new Error(translateDbError(error.message));
      return (data || []).map(normalizeDbApprovedPrice);
    },

    async replaceApprovedPriceItems(items) {
      const payload = (items || [])
        .map((item) => normalizeApprovedPriceInput(item))
        .filter((item) => item.item_key && item.item_name && item.sale_price > 0);

      if (!payload.length) {
        throw new Error("لا توجد أسعار صالحة للحفظ.");
      }

      if (!client) {
        const normalized = payload.map((item) =>
          normalizeDbApprovedPrice({
            ...item,
            id: item.item_key,
            created_at: item.approved_at
          })
        );
        writeJson(APPROVED_PRICES_KEY, normalized);
        return normalized;
      }

      const user = await requireUser();

      // احفظ أرقام وأكواد الأصناف الحالية قبل الحذف كي لا تُمسح عند إعادة الإدخال.
      // بيانات الموقع لا تحمل أرقام الأمين، فنُعيد ربطها من الصفوف الحالية عبر item_key.
      let numberByKey = null; // null = تعذّر الجلب → لا نلمس item_number/item_code (نفس السلوك السابق)
      let codeByKey = null;
      try {
        const { data: existingRows, error: fetchErr } = await client
          .from(approvedPricesTable)
          .select("item_key, item_number, item_code")
          .limit(5000);
        if (!fetchErr) {
          numberByKey = {};
          codeByKey = {};
          for (const row of existingRows || []) {
            if (!row || !row.item_key) continue;
            if (row.item_number != null && String(row.item_number) !== "") {
              numberByKey[row.item_key] = row.item_number;
            }
            if (row.item_code != null && String(row.item_code) !== "") {
              codeByKey[row.item_key] = row.item_code;
            }
          }
        }
      } catch (_) { numberByKey = null; codeByKey = null; }

      // أمان حاسم: هذا المسار يحذف كل الصفوف ثم يعيدها. إن فشل جلب الأرقام الحالية فسيمحو
      // الحذفُ item_number وitem_code بلا رجعة — لذا نُوقف الحفظ بأمان بدل تنفيذ حذف أعمى.
      // الأسعار والأرقام القديمة تبقى سليمة، ويظهر تحذيرٌ للمستخدم ليعيد المحاولة.
      if (!numberByKey || !codeByKey) {
        throw new Error("تعذّر تحضير الحفظ الآمن (فشل قراءة أرقام الأصناف الحالية). لم يُحذف شيء — حاول مجدداً.");
      }

      const withUser = (items || [])
        .map((item) => normalizeApprovedPriceInput(item, user.id))
        .filter((item) => item.item_key && item.item_name && item.sale_price > 0)
        .map((rec) => ({
          ...rec,
          item_number: numberByKey[rec.item_key] ?? null,
          item_code: codeByKey[rec.item_key] ?? null
        }));

      const { error: deleteError } = await client.from(approvedPricesTable).delete().neq("item_key", "__never__");
      if (deleteError) throw new Error(deleteError.message);

      const { data, error } = await client
        .from(approvedPricesTable)
        .insert(withUser)
        // نفس سبب المسار الآخر: الرقمان إلزاميان في الراجع وإلا فُرّغا في الذاكرة.
        .select("id, item_key, item_name, item_number, item_code, sale_price, stock_qty, stock_status, unit1_name, unit2_name, unit2_factor, unit2_price, unit1_price, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at");

      if (error) throw new Error(translateDbError(error.message));
      return (data || []).map(normalizeDbApprovedPrice);
    },

    async listPaymentRecords(customerKey) {
      const key = String(customerKey || "").trim();
      if (!key) return [];
      if (!client) {
        return readJson("payment-records", []).filter((r) => r.customerKey === key);
      }
      const session = await getSupabaseSession();
      if (!session) return [];
      const { data, error } = await client
        .from(paymentRecordsTable)
        .select("id, customer_key, customer_name, amount, payment_date, notes, created_at")
        .eq("customer_key", key)
        .order("payment_date", { ascending: false })
        .limit(100);
      if (error) {
        if (error.code === "42P01") return [];
        throw new Error(error.message);
      }
      return (data || []).map(normalizeDbPaymentRecord);
    },

    async createPaymentRecord(input) {
      const record = {
        customerKey: cleanText(input.customerKey, 240),
        customerName: cleanText(input.customerName, 240),
        amount: Math.max(0, parseNumber(input.amount || 0)),
        paymentDate: String(input.paymentDate || new Date().toISOString().slice(0, 10)),
        notes: cleanText(input.notes, 500)
      };
      if (!record.amount) throw new Error("أدخل مبلغ دفعة صحيح.");
      if (!client) {
        const all = readJson("payment-records", []);
        const local = { id: `PR-${Date.now()}`, ...record, source: "manual", createdAt: new Date().toISOString() };
        writeJson("payment-records", [local, ...all].slice(0, 500));
        return local;
      }
      const user = await requireUser();
      const { data, error } = await client
        .from(paymentRecordsTable)
        .insert({ customer_key: record.customerKey, customer_name: record.customerName, amount: record.amount, payment_date: record.paymentDate, notes: record.notes, created_by: user.id })
        .select("id, customer_key, customer_name, amount, payment_date, notes, created_at")
        .limit(1);
      if (error) {
        if (error.code === "42P01") throw new Error("جدول payment_records غير موجود. شغّل SQL الإعداد في Supabase أولاً.");
        throw new Error(error.message);
      }
      return data?.[0] ? normalizeDbPaymentRecord(data[0]) : { id: `PR-${Date.now()}`, ...record, source: "manual" };
    },

    async listPurchaseInvoices() {
      if (!client) {
        return readJson(PURCHASE_INVOICES_KEY, []).map(normalizeDbPurchaseInvoice);
      }
      const session = await getSupabaseSession();
      if (!session) return [];
      const { data, error } = await client
        .from(purchaseInvoicesTable)
        .select(
          "id, supplier_name, supplier_ameen_guid, supplier_ameen_code, order_date, status, items, currency, pay_method, payment_amount, payment_date, payment_account, paid_total, remaining_total, idempotency_key, sync_attempts, sync_error, ameen_document_guid, ameen_document_number, synced_at, approved_by, approved_at, correction_count, correction_log, total, notes, created_at, updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) {
        if (error.code === "42P01") return [];
        // الأعمدة الجديدة (تسلسل المزامنة) قد لا تكون مُطبَّقة بعد على قاعدة الإنتاج.
        if (error.code === "42703") {
          const fallback = await client
            .from(purchaseInvoicesTable)
            .select("id, supplier_name, order_date, status, items, total, notes, created_at, updated_at")
            .order("created_at", { ascending: false })
            .limit(300);
          if (fallback.error) throw new Error(translateDbError(fallback.error.message));
          return (fallback.data || []).map(normalizeDbPurchaseInvoice);
        }
        throw new Error(translateDbError(error.message));
      }
      return (data || []).map(normalizeDbPurchaseInvoice);
    },

    async listItemSnapshots() {
      if (!client) return [];
      const session = await getSupabaseSession();
      if (!session) return [];
      const { data, error } = await client
        .from(itemSnapshotTable)
        .select(
          "item_key, item_guid, item_number, item_name, unit1_name, unit2_name, unit2_factor, stock_unit1, last_purchase_price, last_purchase_date, last_purchase_currency, last_purchase_unit, average_cost, average_cost_currency, average_cost_basis, last_supplier_name, last_supplier_guid, movement_rank, units_sold_30d, generated_at"
        )
        .limit(5000);
      if (error) {
        if (error.code === "42P01") return []; // الجدول لم يُنشأ بعد على قاعدة الإنتاج — طبيعي قبل تطبيق SQL الجديد
        throw new Error(translateDbError(error.message));
      }
      return (data || []).map(normalizeDbItemSnapshot);
    },

    async createPurchaseInvoice(input) {
      const items = normalizePurchaseItems(input.items);
      const total = roundPrice(items.reduce((sum, item) => sum + item.qty * item.price, 0));
      const payMethod = input.payMethod === "cash" ? "cash" : "credit";
      const paymentAmount = Math.max(0, parseNumber(input.paymentAmount || 0));
      const paidTotal = input.registerPayment ? Math.min(paymentAmount, total) : 0;
      const record = {
        supplier_name: cleanText(input.supplierName, 240),
        supplier_ameen_guid: input.supplierAmeenGuid ? String(input.supplierAmeenGuid) : null,
        supplier_ameen_code: input.supplierAmeenCode ? cleanText(input.supplierAmeenCode, 60) : null,
        order_date: String(input.orderDate || new Date().toISOString().slice(0, 10)),
        status: "draft",
        items,
        currency: PO_CURRENCY_VALUES.includes(input.currency) ? input.currency : "USD",
        pay_method: payMethod,
        payment_amount: input.registerPayment ? paidTotal : 0,
        payment_date: input.registerPayment ? String(input.paymentDate || input.orderDate || new Date().toISOString().slice(0, 10)) : null,
        payment_account: input.registerPayment ? cleanText(input.paymentAccount, 120) : null,
        paid_total: paidTotal,
        remaining_total: roundPrice(total - paidTotal),
        idempotency_key: (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        notes: cleanText(input.notes, 500),
        total
      };
      if (!record.supplier_name) throw new Error("اكتب اسم المورد أولاً.");
      if (!record.items.length) throw new Error("أضف صنفاً واحداً على الأقل مع كمية.");

      if (!client) {
        const all = readJson(PURCHASE_INVOICES_KEY, []);
        const local = {
          id: `local-${Date.now()}`,
          ...record,
          correction_count: 0,
          correction_log: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        writeJson(PURCHASE_INVOICES_KEY, [local, ...all].slice(0, 300));
        return normalizeDbPurchaseInvoice(local);
      }

      const user = await requireUser();
      const { data, error } = await client
        .from(purchaseInvoicesTable)
        .insert({ ...record, created_by: user.id })
        .select(
          "id, supplier_name, supplier_ameen_guid, supplier_ameen_code, order_date, status, items, currency, pay_method, payment_amount, payment_date, payment_account, paid_total, remaining_total, idempotency_key, total, notes, created_at, updated_at"
        )
        .limit(1);
      if (error) {
        if (error.code === "42P01") throw new Error("جدول purchase_invoices غير موجود. شغّل SQL الإعداد في Supabase أولاً.");
        throw new Error(translateDbError(error.message));
      }
      return data?.[0] ? normalizeDbPurchaseInvoice(data[0]) : normalizeDbPurchaseInvoice(record);
    },

    async setPurchaseInvoiceStatus(id, nextStatus, extra = {}) {
      if (!PO_STATUS_VALUES.includes(nextStatus)) throw new Error("حالة فاتورة غير معروفة.");
      const patch = { status: nextStatus, updated_at: new Date().toISOString() };
      if (extra.approvedBy) patch.approved_by = extra.approvedBy;
      if (extra.approvedAt) patch.approved_at = extra.approvedAt;
      if (extra.syncError !== undefined) patch.sync_error = extra.syncError;
      if (!client) {
        const all = readJson(PURCHASE_INVOICES_KEY, []).map((row) =>
          row.id === id ? { ...row, ...patch } : row
        );
        writeJson(PURCHASE_INVOICES_KEY, all);
        return;
      }
      const user = await requireUser();
      // نختم مَن اعتمد الفاتورة ومتى تلقائياً هنا (وليس من app.js) — RLS على Supabase
      // هي الحاجز الفعلي الذي يقرر إن كان هذا المستخدم يملك صلاحية الاعتماد أصلاً.
      if (nextStatus === "approved" && !patch.approved_by) {
        patch.approved_by = user.id;
        patch.approved_at = new Date().toISOString();
      }
      const { error } = await client.from(purchaseInvoicesTable).update(patch).eq("id", id);
      if (error) throw new Error(translateDbError(error.message));
    },

    // إجراء تصحيحي على فاتورة "مُزامَنة" — لا حذف ولا تعديل حر، فقط قيد تصحيحي موثّق
    async correctPurchaseInvoice(id, note, patch = {}) {
      const cleanNote = cleanText(note, 500);
      if (!cleanNote) throw new Error("اكتب سبب الإجراء التصحيحي.");
      if (!client) {
        const all = readJson(PURCHASE_INVOICES_KEY, []).map((row) => {
          if (row.id !== id) return row;
          const log = Array.isArray(row.correction_log) ? row.correction_log : [];
          return {
            ...row,
            ...patch,
            correction_count: Number(row.correction_count || 0) + 1,
            correction_log: [...log, { note: cleanNote, at: new Date().toISOString() }],
            updated_at: new Date().toISOString()
          };
        });
        writeJson(PURCHASE_INVOICES_KEY, all);
        return;
      }
      const user = await requireUser();
      const { data: current, error: readErr } = await client
        .from(purchaseInvoicesTable)
        .select("correction_count, correction_log")
        .eq("id", id)
        .limit(1);
      if (readErr) throw new Error(translateDbError(readErr.message));
      const row = current?.[0] || {};
      const log = Array.isArray(row.correction_log) ? row.correction_log : [];
      const entry = { note: cleanNote, at: new Date().toISOString(), by: user.id };
      const { error } = await client
        .from(purchaseInvoicesTable)
        .update({
          ...patch,
          correction_count: Number(row.correction_count || 0) + 1,
          correction_log: [...log, entry],
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
      if (error) throw new Error(translateDbError(error.message));
    },

    async deletePurchaseInvoice(id) {
      if (!client) {
        const all = readJson(PURCHASE_INVOICES_KEY, []).filter((row) => row.id !== id);
        writeJson(PURCHASE_INVOICES_KEY, all);
        return;
      }
      await requireUser();
      const { error } = await client.from(purchaseInvoicesTable).delete().eq("id", id);
      if (error) throw new Error(translateDbError(error.message));
    },

    // مستندات المرتجعات (مبيعات جملة/مركز، مشتريات) — جدول returns، غير مُطبَّق بعد
    // على قاعدة الإنتاج (supabase/returns-table.sql مرجعي فقط)، لذا 42P01 متوقع حالياً.
    async listReturnDocuments() {
      if (!client) {
        return readJson(RETURNS_KEY, []).map(normalizeDbReturn);
      }
      const session = await getSupabaseSession();
      if (!session) return [];
      const { data, error } = await client
        .from(returnsTable)
        .select(
          "id, kind, party_name, party_ameen_guid, party_ameen_code, original_invoice_number, original_invoice_guid, original_invoice_date, original_pay_method, treasury_name, reason, items, total, status, idempotency_key, sync_attempts, sync_error, ameen_document_guid, ameen_document_number, synced_at, approved_by, approved_at, correction_count, correction_log, reversed_revenue, reversed_cost, reversed_profit, settlement_type, settlement_target_id, settlement_amount, stock_applied, stock_applied_at, stock_applied_items, created_at, updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) {
        if (error.code === "42P01") return []; // الجدول لم يُطبَّق بعد على قاعدة الإنتاج
        throw new Error(translateDbError(error.message));
      }
      return (data || []).map(normalizeDbReturn);
    },

    async createReturnDocument(input) {
      const items = normalizeReturnItems(input.items);
      const total = roundPrice(items.reduce((sum, item) => sum + item.qty * item.price, 0));
      const record = {
        kind: RET_KIND_VALUES.includes(input.kind) ? input.kind : "sales_wholesale",
        party_name: cleanText(input.partyName, 240),
        party_ameen_guid: input.partyAmeenGuid ? String(input.partyAmeenGuid) : null,
        party_ameen_code: input.partyAmeenCode ? cleanText(input.partyAmeenCode, 60) : null,
        original_invoice_number: cleanText(input.originalInvoiceNumber, 60),
        original_invoice_guid: input.originalInvoiceGuid ? String(input.originalInvoiceGuid) : null,
        original_invoice_date: input.originalInvoiceDate || null,
        original_pay_method: RET_PAY_METHOD_VALUES.includes(input.originalPayMethod) ? input.originalPayMethod : "credit",
        treasury_name: input.treasuryName ? cleanText(input.treasuryName, 120) : null,
        reason: cleanText(input.reason, 500),
        items,
        idempotency_key: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        total,
        status: "draft"
      };
      if (!record.party_name) throw new Error("اختر الزبون أو المورد أولاً.");
      if (!record.original_invoice_number) throw new Error("اختر الفاتورة الأصلية أولاً.");
      if (!record.items.length) throw new Error("أضف صنفاً واحداً على الأقل مع كمية مرتجعة.");
      if (record.original_pay_method === "cash" && !record.treasury_name) {
        throw new Error("أدخل صندوق الاسترداد (نفس صندوق الفاتورة الأصلية) لأن الفاتورة نقدية.");
      }

      if (!client) {
        const all = readJson(RETURNS_KEY, []);
        const local = {
          id: `local-${Date.now()}`,
          ...record,
          correction_count: 0,
          correction_log: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        writeJson(RETURNS_KEY, [local, ...all].slice(0, 300));
        return normalizeDbReturn(local);
      }

      const user = await requireUser();
      const { data, error } = await client
        .from(returnsTable)
        .insert({ ...record, created_by: user.id })
        .select(
          "id, kind, party_name, party_ameen_guid, party_ameen_code, original_invoice_number, original_invoice_guid, original_invoice_date, original_pay_method, treasury_name, reason, items, total, status, created_at, updated_at"
        )
        .limit(1);
      if (error) {
        if (error.code === "42P01") throw new Error("جدول returns غير موجود بعد. طبّق supabase/returns-table.sql في Supabase أولاً.");
        throw new Error(translateDbError(error.message));
      }
      return data?.[0] ? normalizeDbReturn(data[0]) : normalizeDbReturn(record);
    },

    async setReturnDocumentStatus(id, nextStatus, extra = {}) {
      if (!RET_STATUS_VALUES.includes(nextStatus)) throw new Error("حالة مرتجع غير معروفة.");
      // اعتماد ("approved") له مسار مخصص (approveReturnDocument) يعكس الربح/التكلفة
      // ويطبّق أثر التسوية والمخزون فعلياً — هذه الدالة العامة لا يجوز أن تُستخدَم
      // لتمرير حالة "approved" لأنها ستتخطى ذلك المسار وتترك المستند بلا أثر حقيقي.
      if (nextStatus === "approved") {
        throw new Error("استخدم approveReturnDocument للاعتماد الفعلي، وليس setReturnDocumentStatus.");
      }
      const patch = { status: nextStatus, updated_at: new Date().toISOString() };
      if (extra.syncError !== undefined) patch.sync_error = extra.syncError;
      if (!client) {
        const all = readJson(RETURNS_KEY, []).map((row) => (row.id === id ? { ...row, ...patch } : row));
        writeJson(RETURNS_KEY, all);
        return;
      }
      await requireUser();
      const { error } = await client.from(returnsTable).update(patch).eq("id", id);
      if (error) throw new Error(translateDbError(error.message));
    },

    // اعتماد فعلي لمستند مرتجع: يعكس الربح/التكلفة (retCalc.retInvoiceProfitReversal)،
    // يحدد أثر التسوية (retCalc.retSettlementImpact) ويثبّته على المستند نفسه (لا يوجد
    // دفتر أرصدة زبائن/موردين قابل للكتابة محلياً بعد، لذا التسوية تُحفَظ كحقل بيانات
    // على returns نفسه: settlement_type/target_id/amount — وليست مطبَّقة فعلياً على أي
    // رصيد خارجي؛ هذا موثّق صراحة في AI_HANDOFF.md).
    //
    // ترتيب مقصود (إصلاح مراجعة PR #37 — كان أثر المخزون يُطبَّق قبل تثبيت الاعتماد):
    // 1) يُثبَّت الاعتماد (status=approved + الأثر المالي) أولاً، بتحديث شرطي
    //    (eq("status", doc.status)) يمنع اعتماد مزدوج متزامن لنفس المستند.
    // 2) بعد نجاح خطوة (1) فقط، يُطبَّق أثر المخزون (أفضل جهد لكل صنف) عبر
    //    applyReturnStockForDoc. فشل تحديد وحدة/صنف بثقة لا يوقف الاعتماد المالي
    //    (يبقى صحيحاً ومحفوظاً) لكنه يُجمَّع في stockWarnings ليعرضه app.js صراحة
    //    للمستخدم — لا كتمان صامت لفشل جزئي.
    // إن انقطع التنفيذ بين (1) و(2) أو فشل بعض الأصناف، تبقى stock_applied=false
    // ويُستأنَف تطبيق المخزون فقط (دون إعادة حساب الأثر المالي أو اعتماد مزدوج)
    // في مطلع هذه الدالة عبر مسار "إكمال معلَّق" أدناه.
    async approveReturnDocument(id, doc) {
      if (!doc) throw new Error("مستند المرتجع غير موجود.");

      // مسار إكمال معلَّق: المستند معتمَد فعلاً لكن تطبيق المخزون لم يكتمل
      // (فشل/انقطاع بعد تثبيت الاعتماد وقبل انتهاء حلقة المخزون) — لا نعيد حساب
      // الأثر المالي ولا نمر بأي تحقق اعتماد، فقط نكمل الأصناف المتبقية.
      if (doc.status === "approved" && !doc.stockApplied) {
        return applyReturnStockForDoc(id, doc, doc.stockAppliedItems);
      }

      // دفاع بعمق: قيد السبب موجود بالواجهة (retSetStatus) وبقاعدة البيانات
      // (returns_reason_required_after_draft) — نكرره هنا لأن المسار المحلي (بلا
      // Supabase) لا يمر بذلك القيد إطلاقاً.
      if (!String(doc.reason || "").trim()) {
        throw new Error("لا يمكن اعتماد مرتجع بلا سبب مكتوب.");
      }
      if (!retCalc.retCanTransitionStatus(doc.status, "approved")) {
        throw new Error("لا يمكن الانتقال إلى حالة معتمد من الحالة الحالية.");
      }

      const items = Array.isArray(doc.items) ? doc.items : [];
      const reversal = retCalc.retInvoiceProfitReversal(
        items.map((item) => ({
          returnQty: item.qty,
          unitPrice: item.price,
          unitCost: item.unitCost != null ? item.unitCost : item.unit_cost || 0
        }))
      );

      const kind = doc.kind === "purchase" ? "purchase" : "sales";
      const settlement = retCalc.retSettlementImpact({
        kind,
        amount: doc.total,
        supplierId: kind === "purchase" ? doc.partyAmeenGuid || doc.partyAmeenCode || null : null,
        customerId: kind === "sales" ? doc.partyAmeenGuid || doc.partyAmeenCode || null : null,
        originalPayMethod: doc.originalPayMethod,
        treasuryId: doc.treasuryName || null
      });
      if (!settlement.ok) {
        throw new Error(settlement.error || "تعذّر احتساب أثر التسوية لهذا المرتجع.");
      }

      const patch = {
        status: "approved",
        reversed_revenue: reversal.revenueReversed,
        reversed_cost: reversal.costReversed,
        reversed_profit: reversal.profitReversed,
        settlement_type: settlement.type,
        settlement_target_id: String(settlement.supplierId || settlement.customerId || settlement.treasuryId || ""),
        settlement_amount: settlement.amount,
        stock_applied: false,
        stock_applied_items: [],
        stock_applied_at: null,
        updated_at: new Date().toISOString()
      };

      if (!client) {
        const all = readJson(RETURNS_KEY, []);
        const row = all.find((r) => r.id === id);
        if (!row || row.status !== doc.status) {
          throw new Error("تغيّرت حالة المستند من جهة أخرى، أعد تحميل الصفحة قبل الاعتماد.");
        }
        writeJson(RETURNS_KEY, all.map((r) => (r.id === id ? { ...r, ...patch } : r)));
        const stockResult = await applyReturnStockForDoc(id, { ...doc, items }, []);
        return stockResult;
      }

      const user = await requireUser();
      patch.approved_by = user.id;
      patch.approved_at = new Date().toISOString();
      // تحديث شرطي على الحالة الحالية: إن اعتمد طرف آخر المستند بين قراءته
      // وهذا الاستدعاء، لن يُطابَق أي صف (data فارغة) بدل الكتابة فوق اعتماد سابق.
      const { data, error } = await client
        .from(returnsTable)
        .update(patch)
        .eq("id", id)
        .eq("status", doc.status)
        .select("id");
      if (error) throw new Error(translateDbError(error.message));
      if (!data || !data.length) {
        throw new Error("تغيّرت حالة المستند من جهة أخرى، أعد تحميل الصفحة قبل الاعتماد.");
      }
      const stockResult = await applyReturnStockForDoc(id, { ...doc, items }, []);
      return stockResult;
    },

    // إجراء تصحيحي موثّق على مرتجع بعد اعتماده — نفس نمط correctPurchaseInvoice.
    // لا يعدّل الحقول المالية المقفلة مباشرة (تلك محمية بقيد قاعدة البيانات
    // returns_guard_immutable_and_stamp)؛ الاستخدام المقصود هو تسجيل ملاحظة/تصحيح
    // موثّق (وربما تعديل حقول غير مالية مسموحة) لا تعديل حر لمحتوى المرتجع المعتمد.
    async correctReturnDocument(id, note, patch = {}) {
      const cleanNote = cleanText(note, 500);
      if (!cleanNote) throw new Error("اكتب سبب الإجراء التصحيحي.");
      if (!client) {
        const all = readJson(RETURNS_KEY, []).map((row) => {
          if (row.id !== id) return row;
          const log = Array.isArray(row.correction_log) ? row.correction_log : [];
          return {
            ...row,
            ...patch,
            correction_count: Number(row.correction_count || 0) + 1,
            correction_log: [...log, { note: cleanNote, at: new Date().toISOString() }],
            updated_at: new Date().toISOString()
          };
        });
        writeJson(RETURNS_KEY, all);
        return;
      }
      const user = await requireUser();
      const { data: current, error: readErr } = await client
        .from(returnsTable)
        .select("correction_count, correction_log")
        .eq("id", id)
        .limit(1);
      if (readErr) throw new Error(translateDbError(readErr.message));
      const row = current?.[0] || {};
      const log = Array.isArray(row.correction_log) ? row.correction_log : [];
      const entry = { note: cleanNote, at: new Date().toISOString(), by: user.id };
      const { error } = await client
        .from(returnsTable)
        .update({
          ...patch,
          correction_count: Number(row.correction_count || 0) + 1,
          correction_log: [...log, entry],
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
      if (error) throw new Error(translateDbError(error.message));
    },

    async deleteReturnDocument(id) {
      if (!client) {
        const all = readJson(RETURNS_KEY, []).filter((row) => row.id !== id);
        writeJson(RETURNS_KEY, all);
        return;
      }
      await requireUser();
      const { error } = await client.from(returnsTable).delete().eq("id", id);
      if (error) throw new Error(translateDbError(error.message));
    },

    async listCustomerProfiles() {
      if (!client) return readJson("customer-profiles", []);
      const session = await getSupabaseSession();
      if (!session) return [];
      const { data, error } = await client
        .from(customerProfilesTable)
        .select("id, customer_key, customer_name, phone, address, notes, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) {
        if (error.code === "42P01") return [];
        throw new Error(error.message);
      }
      return (data || []).map(normalizeDbCustomerProfile);
    },

    async upsertCustomerProfile(input) {
      const profile = {
        customerKey: cleanText(input.customerKey, 240),
        customerName: cleanText(input.customerName, 240),
        phone: cleanText(input.phone, 40),
        address: cleanText(input.address, 240),
        notes: cleanText(input.notes, 500)
      };
      if (!profile.customerKey) throw new Error("لا يمكن حفظ بيانات زبون بدون مفتاح.");
      if (!client) {
        const all = readJson("customer-profiles", []);
        const idx = all.findIndex((p) => p.customerKey === profile.customerKey);
        const rec = { id: profile.customerKey, ...profile, updatedAt: new Date().toISOString() };
        if (idx >= 0) all[idx] = rec; else all.unshift(rec);
        writeJson("customer-profiles", all);
        return rec;
      }
      const user = await requireUser();
      const { data, error } = await client
        .from(customerProfilesTable)
        .upsert({ customer_key: profile.customerKey, customer_name: profile.customerName, phone: profile.phone, address: profile.address, notes: profile.notes, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: "customer_key" })
        .select("id, customer_key, customer_name, phone, address, notes, updated_at")
        .limit(1);
      if (error) {
        if (error.code === "42P01") throw new Error("جدول customer_profiles غير موجود. شغّل SQL الإعداد في Supabase أولاً.");
        throw new Error(error.message);
      }
      return data?.[0] ? normalizeDbCustomerProfile(data[0]) : { id: profile.customerKey, ...profile, updatedAt: new Date().toISOString() };
    },

    async createInventoryReport(report) {
      const localReport = {
        id: report.id || `local-${Date.now()}`,
        report_date: report.reportDate,
        source: report.source || "ameen_excel",
        summary: report.summary || {},
        items: report.items || [],
        created_at: new Date().toISOString()
      };

      if (!client) {
        const reports = [localReport, ...readJson(INVENTORY_REPORTS_KEY, [])].slice(0, 12);
        writeJson(INVENTORY_REPORTS_KEY, reports);
        return localReport;
      }

      const user = await requireUser();
      const { data, error } = await client
        .from(inventoryReportsTable)
        .insert({
          report_date: localReport.report_date,
          source: localReport.source,
          summary: localReport.summary,
          items: localReport.items,
          created_by: user.id
        })
        .select("id, report_date, source, summary, items, created_at")
        .limit(1);

      if (error) throw new Error(translateDbError(error.message));
      return data?.[0] || localReport;
    }
  };

  window.tobaccoData = service;
})();
