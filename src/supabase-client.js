(function () {
  const SESSION_KEY = "tobacco-session";
  const REQUESTS_KEY = "tobacco-requests";

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
      name: user.user_metadata?.display_name || user.email || "موظف TOBACCO",
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

  async function getSupabaseSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error(error.message);
    return normalizeSession(data.session);
  }

  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("سجل الدخول أولا قبل حفظ الطلبات.");
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
          name: cleanText(input.name, 80) || "موظف TOBACCO",
          role: cleanText(input.role, 40) || "خدمة العملاء"
        };
        writeJson(SESSION_KEY, session);
        return { session };
      }

      const email = cleanText(input.email, 160);
      const password = String(input.password || "");
      if (!email || !password) throw new Error("اكتب البريد وكلمة المرور.");

      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return { session: normalizeSession(data.session) };
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
    }
  };

  window.tobaccoData = service;
})();
