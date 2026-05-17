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

  const config = window.appConfig?.supabase || {};
  const hasConfig = Boolean(config.url && config.publishableKey);
  const hasLibrary = Boolean(window.supabase?.createClient);
  const tableName = config.requestsTable || "customer_requests";
  const inventoryReportsTable = config.inventoryReportsTable || "inventory_reports";
  const creditLimitsTable = config.creditLimitsTable || "customer_credit_limits";
  const approvedPricesTable = config.approvedPricesTable || "approved_price_items";
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

    return {
      provider: "supabase",
      id: user.id,
      email: user.email || "",
      name: user.user_metadata?.display_name || user.email || "موظف OZK",
      role: user.user_metadata?.role || "خدمة العملاء"
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
      creditLimit: Number(row.credit_limit || 0),
      notes: row.notes || "",
      updatedAt: row.updated_at || row.created_at || ""
    };
  }

  function normalizeCustomerLimitInput(input, userId = null) {
    const creditLimit = Number(input.creditLimit || 0);
    return {
      customer_key: cleanText(input.customerKey, 240),
      customer_name: cleanText(input.customerName, 240),
      credit_limit: Number.isFinite(creditLimit) ? Math.max(0, creditLimit) : 0,
      notes: cleanText(input.notes, 500),
      updated_at: new Date().toISOString(),
      ...(userId ? { updated_by: userId } : {})
    };
  }

  function normalizeDbApprovedPrice(row) {
    return {
      id: row.id,
      itemKey: row.item_key,
      itemName: row.item_name || "",
      salePrice: Number(row.sale_price || 0),
      stockQty: Number(row.stock_qty || 0),
      stockStatus: row.stock_status || "",
      sourceReportId: row.source_report_id || "",
      sourceSyncedAt: row.source_synced_at || "",
      pricePayload: row.price_payload || {},
      notes: row.notes || "",
      approvedAt: row.approved_at || row.updated_at || row.created_at || "",
      updatedAt: row.updated_at || row.approved_at || row.created_at || ""
    };
  }

  function normalizeApprovedPriceInput(input, userId = null) {
    const salePrice = Number(input.salePrice || 0);
    const stockQty = Number(input.stockQty || 0);
    return {
      item_key: cleanText(input.itemKey, 240),
      item_name: cleanText(input.itemName, 240),
      sale_price: Number.isFinite(salePrice) ? Math.max(0, salePrice) : 0,
      stock_qty: Number.isFinite(stockQty) ? stockQty : 0,
      stock_status: cleanText(input.stockStatus, 40),
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
    if (/auth session missing|session.*missing/i.test(message || "")) {
      return missingSessionMessage();
    }
    return message;
  }

  async function getSupabaseSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(error.message);
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
      if (error) throw new Error(error.message);

      return {
        session: normalizeSession(data.session),
        needsEmailConfirmation: !data.session
      };
    },

    async signOut() {
      if (client) {
        const { error } = await client.auth.signOut();
        if (error) throw new Error(error.message);
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

      if (error) throw new Error(error.message);
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
        .single();

      if (error) throw new Error(error.message);
      return normalizeDbRequest(data);
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

      if (error) throw new Error(error.message);
    },

    async listInventoryReports() {
      if (!client) {
        return readJson(INVENTORY_REPORTS_KEY, []).filter((report) => report.source !== "ameen_customer_balances");
      }

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(inventoryReportsTable)
        .select("id, report_date, source, summary, items, created_at")
        .neq("source", "ameen_customer_balances")
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) throw new Error(error.message);
      return data || [];
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

      if (error) throw new Error(error.message);
      return data || [];
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

      if (error) throw new Error(error.message);
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
        .single();

      if (error) throw new Error(error.message);
      return normalizeDbCustomerLimit(data);
    },

    async listApprovedPriceItems() {
      if (!client) return readJson(APPROVED_PRICES_KEY, []);

      const session = await getSupabaseSession();
      if (!session) return [];

      const { data, error } = await client
        .from(approvedPricesTable)
        .select("id, item_key, item_name, sale_price, stock_qty, stock_status, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at")
        .order("item_name", { ascending: true })
        .limit(5000);

      if (error) throw new Error(error.message);
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
        .select("id, item_key, item_name, sale_price, stock_qty, stock_status, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at");

      if (error) throw new Error(error.message);
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
        .select("id, item_key, item_name, sale_price, stock_qty, stock_status, source_report_id, source_synced_at, price_payload, notes, approved_at, updated_at");

      if (error) throw new Error(error.message);
      return (data || []).map(normalizeDbApprovedPrice);
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
        .single();

      if (error) throw new Error(error.message);
      return data;
    }
  };

  window.tobaccoData = service;
})();
