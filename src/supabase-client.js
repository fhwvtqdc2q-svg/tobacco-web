(function () {
  const SESSION_KEY = "tobacco-session";
  const REQUESTS_KEY = "tobacco-requests";
  const INVENTORY_REPORTS_KEY = "tobacco-inventory-reports";
  const CUSTOMER_LIMITS_KEY = "tobacco-customer-credit-limits";
  const APPROVED_PRICES_KEY = "tobacco-approved-price-items";

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

    async listInventoryReports() {
      if (!client) {
        return readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source !== "ameen_customer_balances" && report.source !== "ameen_customer_movements");
      }

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .not("source", "in", '("ameen_customer_balances","ameen_customer_movements")')
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
        .select("id")
        .single();
      if (error) throw new Error(translateDbError(error.message));
      return data.id;
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
        .select("id, item_key, item_name, sale_price, stock_qty, stock_status, unit1_name, unit2_name, unit2_factor, unit2_price, unit1_price, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at")
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
      const withUser = (items || [])
        .map((item) => normalizeApprovedPriceInput(item, user.id))
        .filter((item) => item.item_key && item.item_name && item.sale_price > 0);
      const { data, error } = await client
        .from(approvedPricesTable)
        .upsert(withUser, { onConflict: "item_key" })
        .select("id, item_key, item_name, sale_price, stock_qty, stock_status, unit1_name, unit2_name, unit2_factor, unit2_price, unit1_price, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at");

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
      const withUser = (items || [])
        .map((item) => normalizeApprovedPriceInput(item, user.id))
        .filter((item) => item.item_key && item.item_name && item.sale_price > 0);

      const { error: deleteError } = await client.from(approvedPricesTable).delete().neq("item_key", "__never__");
      if (deleteError) throw new Error(deleteError.message);

      const { data, error } = await client
        .from(approvedPricesTable)
        .insert(withUser)
        .select("id, item_key, item_name, sale_price, stock_qty, stock_status, unit1_name, unit2_name, unit2_factor, unit2_price, unit1_price, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at");

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
