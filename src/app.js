const appConfig = window.appConfig;
const roadmapItems = window.roadmapItems;
const monitoringCards = window.monitoringCards;
const remoteServices = window.remoteServices;
const dataStore = window.tobaccoData;

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[char];
  });
}

function formValue(form, name) {
  return String(new FormData(form).get(name) || "").trim();
}

const state = {
  route: "overview",
  installPrompt: null,
  completed: new Set(readJson("completed-items", [])),
  session: null,
  requests: [],
  loading: true,
  notice: null
};

const app = document.querySelector("#app");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  render();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("public/service-worker.js").catch(() => {});
  });
}

function setNotice(type, text) {
  state.notice = { type, text };
}

async function boot() {
  await refreshSession();
  await loadRequests();
  state.loading = false;
  render();
}

async function refreshSession() {
  try {
    state.session = await dataStore.getSession();
  } catch (error) {
    state.session = null;
    setNotice("error", `تعذر فحص تسجيل الدخول: ${error.message}`);
  }
}

async function loadRequests() {
  try {
    if (dataStore.isConfigured() && !state.session) {
      state.requests = [];
      return;
    }
    state.requests = await dataStore.listRequests();
  } catch (error) {
    state.requests = dataStore.defaultRequests;
    setNotice("error", `تعذر تحميل الطلبات: ${error.message}`);
  }
}

function setRoute(route, clearNotice = true) {
  state.route = route;
  if (clearNotice) state.notice = null;
  render();
}

function toggleItem(id) {
  if (state.completed.has(id)) {
    state.completed.delete(id);
  } else {
    state.completed.add(id);
  }
  writeJson("completed-items", [...state.completed]);
  render();
}

async function saveSession(form, action) {
  try {
    const input = {
      name: formValue(form, "name"),
      role: formValue(form, "role"),
      email: formValue(form, "email"),
      password: formValue(form, "password")
    };

    const result = action === "signup" ? await dataStore.signUp(input) : await dataStore.signIn(input);
    state.session = result.session || (await dataStore.getSession());

    if (result.needsEmailConfirmation) {
      setNotice("success", "تم إنشاء الحساب. إذا كان تأكيد البريد مفعلا في Supabase، افتح البريد ثم سجل الدخول.");
    } else {
      setNotice("success", dataStore.isConfigured() ? "تم تسجيل الدخول عبر Supabase." : "تم تسجيل الدخول التجريبي محليا.");
    }

    await loadRequests();
    setRoute("overview", false);
  } catch (error) {
    setNotice("error", error.message);
    render();
  }
}

async function logout() {
  try {
    await dataStore.signOut();
    state.session = null;
    setNotice("success", "تم تسجيل الخروج.");
  } catch (error) {
    setNotice("error", error.message);
  }
  render();
}

async function addRequest(form) {
  try {
    await dataStore.createRequest({
      customer: formValue(form, "customer"),
      channel: formValue(form, "channel"),
      type: formValue(form, "type"),
      note: formValue(form, "note")
    });
    await loadRequests();
    setNotice("success", dataStore.isConfigured() ? "تم حفظ الطلب في Supabase." : "تم حفظ الطلب محليا للتجربة.");
    setRoute("requests", false);
  } catch (error) {
    setNotice("error", error.message);
    if (/سجل الدخول/i.test(error.message)) state.route = "login";
    render();
  }
}

async function updateRequest(id, status) {
  try {
    await dataStore.updateRequestStatus(id, status);
    await loadRequests();
    setNotice("success", "تم تحديث حالة الطلب.");
  } catch (error) {
    setNotice("error", error.message);
  }
  render();
}

async function installApp() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  render();
}

function completionPercent() {
  return Math.round((state.completed.size / roadmapItems.length) * 100);
}

function shell(content) {
  return `
    <div class="app-shell">
      <aside class="sidebar" aria-label="التنقل">
        <a class="brand" href="#" data-route="overview" aria-label="الرئيسية">
          <img src="public/icons/app-icon.svg" alt="">
          <span>${escapeHtml(appConfig.name)}</span>
        </a>
        <nav>
          ${navButton("overview", "الرئيسية")}
          ${navButton("login", "تسجيل الدخول")}
          ${navButton("requests", "طلبات العملاء")}
          ${navButton("remote", "إدارة عن بعد")}
          ${navButton("monitoring", "المراقبة")}
          ${navButton("payments", "الدفع")}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <p class="eyebrow">${escapeHtml(appConfig.tagline)}</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="topbar-actions">
            ${state.installPrompt ? '<button class="button secondary" data-action="install">تثبيت</button>' : ""}
            ${state.session ? `<button class="button secondary" data-action="logout">${escapeHtml(state.session.name)}</button>` : ""}
            <a class="button primary" href="mailto:${escapeHtml(appConfig.supportEmail)}">الدعم</a>
          </div>
        </header>
        ${connectionNotice()}
        ${messagePanel()}
        ${state.loading ? loadingPanel() : content}
      </main>
    </div>
  `;
}

function connectionNotice() {
  if (location.protocol === "file:") {
    return `
      <section class="notice-panel warning">
        <strong>هذه نسخة محلية على اللابتوب.</strong>
        <span>للاستخدام من الايفون افتح رابط GitHub Pages، ولا تستخدم رابط <code>file:///C:/...</code>.</span>
      </section>
    `;
  }

  if (dataStore.isConfigured()) {
    return `
      <section class="notice-panel success">
        <strong>${escapeHtml(dataStore.statusLabel())}</strong>
        <span>الطلبات وتسجيل الدخول سيعملان من قاعدة البيانات. لا تضع مفتاح service_role داخل الواجهة أبدا.</span>
      </section>
    `;
  }

  return `
    <section class="notice-panel">
      <strong>${escapeHtml(dataStore.statusLabel())}</strong>
      <span>الموقع جاهز للربط. أضف رابط Supabase والمفتاح العام في <code>src/config.js</code> بعد إنشاء الجداول.</span>
    </section>
  `;
}

function messagePanel() {
  if (!state.notice) return "";
  return `<section class="message-panel ${state.notice.type}">${escapeHtml(state.notice.text)}</section>`;
}

function loadingPanel() {
  return `<section class="panel wide"><h2>جاري التحميل...</h2><p class="muted">نجهز بيانات التطبيق.</p></section>`;
}

function navButton(route, label) {
  const active = state.route === route ? "active" : "";
  return `<button class="nav-link ${active}" data-route="${route}">${label}</button>`;
}

function pageTitle() {
  return {
    overview: "لوحة TOBACCO",
    login: "تسجيل الدخول",
    requests: "طلبات العملاء",
    remote: "الإدارة عن بعد",
    monitoring: "المراقبة",
    payments: "الدفع"
  }[state.route];
}

function overview() {
  const done = completionPercent();
  const openRequests = state.requests.filter((request) => request.status !== "مغلق").length;

  return shell(`
    <section class="hero-panel business-hero">
      <div class="hero-copy">
        <p class="eyebrow">TOBACCO</p>
        <h2>منصة عربية لخدمة العملاء ومتابعة العمل عن بعد.</h2>
        <p>${escapeHtml(appConfig.description)}</p>
        <div class="metric-row">
          <div class="metric">
            <strong>${openRequests}</strong>
            <span>طلبات مفتوحة</span>
          </div>
          <div class="metric">
            <strong>${done}%</strong>
            <span>جاهزية الميزات</span>
          </div>
          <div class="metric">
            <strong>${dataStore.isConfigured() ? "Live" : "Demo"}</strong>
            <span>${dataStore.isConfigured() ? "قاعدة Supabase" : "حفظ محلي"}</span>
          </div>
        </div>
      </div>
      <div class="status-board">
        ${monitoringCards.map(statusCard).join("")}
      </div>
    </section>

    <section class="content-grid">
      <article class="panel">
        <h3>أولويات التشغيل</h3>
        <div class="task-list">
          ${roadmapItems.slice(0, 5).map(taskItem).join("")}
        </div>
      </article>
      <article class="panel">
        <h3>تشغيل اليوم</h3>
        <ol class="steps">
          <li>افتح صفحة تسجيل الدخول واستخدم الدخول التجريبي أو حساب Supabase بعد التفعيل.</li>
          <li>أضف طلب عميل من صفحة طلبات العملاء.</li>
          <li>راجع صفحة المراقبة لمعرفة حالة العمل.</li>
          <li>اترك الدفع كواجهة فقط إلى أن نختار مزودا مناسبا.</li>
        </ol>
      </article>
    </section>
  `);
}

function login() {
  const live = dataStore.isConfigured();
  return shell(`
    <section class="panel wide form-layout">
      <div>
        <p class="eyebrow">Access</p>
        <h2>دخول الموظفين والإدارة</h2>
        <p class="muted">
          ${live
            ? "هذا الدخول متصل بقاعدة Supabase. استخدم بريد وكلمة مرور لحساب موظف."
            : "هذا دخول تجريبي محلي الآن. بعد إضافة مفاتيح Supabase سيصبح الدخول حقيقيا."}
        </p>
      </div>
      <form class="form-card" data-form="login">
        <label>
          اسم المستخدم
          <input name="name" placeholder="مثال: أحمد من خدمة العملاء" autocomplete="name">
        </label>
        <label>
          الدور
          <select name="role">
            <option>خدمة العملاء</option>
            <option>الإدارة</option>
            <option>المراقبة</option>
            <option>الدعم الفني</option>
          </select>
        </label>
        <label class="${live ? "" : "optional-field"}">
          البريد
          <input name="email" type="email" placeholder="staff@example.com" autocomplete="email">
        </label>
        <label class="${live ? "" : "optional-field"}">
          كلمة المرور
          <input name="password" type="password" minlength="8" autocomplete="current-password">
        </label>
        <div class="button-row">
          <button class="button primary" type="submit" data-auth-action="signin">${live ? "دخول" : "دخول تجريبي"}</button>
        </div>
        ${live ? '<p class="muted">أنشئ حسابات الموظفين من Supabase Authentication لتجنب حد رسائل البريد.</p>' : ""}
        ${state.session ? `<p class="success-note">أنت داخل الآن باسم ${escapeHtml(state.session.name)} - ${escapeHtml(state.session.role)}</p>` : ""}
      </form>
    </section>
  `);
}

function requests() {
  const loginPrompt =
    dataStore.isConfigured() && !state.session
      ? '<p class="muted">سجل الدخول أولا حتى تظهر طلبات Supabase وتستطيع إضافة طلب جديد. إذا أنشأت الحساب للتو، قد تحتاج تأكيد البريد أولا.</p>'
      : "";

  return shell(`
    <section class="content-grid request-layout">
      <article class="panel">
        <h3>إضافة طلب عميل</h3>
        ${loginPrompt}
        <form class="form-card compact" data-form="request">
          <label>
            اسم العميل
            <input name="customer" maxlength="120" placeholder="اسم العميل أو رقم الطلب">
          </label>
          <label>
            القناة
            <select name="channel">
              <option>واتساب</option>
              <option>هاتف</option>
              <option>ويب</option>
              <option>زيارة فرع</option>
            </select>
          </label>
          <label>
            نوع الطلب
            <select name="type">
              <option>استفسار</option>
              <option>شكوى</option>
              <option>متابعة</option>
              <option>طلب خدمة</option>
            </select>
          </label>
          <label>
            ملاحظة
            <textarea name="note" rows="4" maxlength="1000" placeholder="اكتب ملخص الطلب"></textarea>
          </label>
          <button class="button primary" type="submit">حفظ الطلب</button>
        </form>
      </article>
      <article class="panel">
        <h3>سجل الطلبات</h3>
        <div class="request-list">
          ${state.requests.length ? state.requests.map(requestCard).join("") : loginPrompt || '<p class="muted">لا توجد طلبات بعد.</p>'}
        </div>
      </article>
    </section>
  `);
}

function remote() {
  return shell(`
    <section class="panel wide">
      <div class="section-head">
        <div>
          <p class="eyebrow">Remote Management</p>
          <h2>خدمة الإدارة عن بعد</h2>
        </div>
      </div>
      <div class="service-grid">
        ${remoteServices.map((service) => `<article><strong>${escapeHtml(service)}</strong><p>جاهزة كواجهة تشغيل، وتقرأ من قاعدة البيانات بعد ربط Supabase.</p></article>`).join("")}
      </div>
    </section>
  `);
}

function monitoring() {
  const openRequests = state.requests.filter((request) => request.status !== "مغلق").length;
  const closedRequests = state.requests.length - openRequests;
  const cards = [
    { label: "طلبات مفتوحة", value: String(openRequests), trend: "من سجل الطلبات" },
    { label: "طلبات مغلقة", value: String(closedRequests), trend: "تمت متابعتها" },
    ...monitoringCards.slice(1)
  ];

  return shell(`
    <section class="panel wide">
      <div class="section-head">
        <div>
          <p class="eyebrow">Monitoring</p>
          <h2>مراقبة خدمة العملاء</h2>
        </div>
      </div>
      <div class="status-board full">
        ${cards.map(statusCard).join("")}
      </div>
      <div class="audit-note">
        <strong>ملاحظة تشغيلية:</strong>
        <span>${dataStore.isConfigured() ? "هذه المؤشرات تقرأ من جدول الطلبات في Supabase." : "هذه المؤشرات تجريبية وتعتمد على الحفظ المحلي في هذا المتصفح."}</span>
      </div>
    </section>
  `);
}

function payments() {
  return shell(`
    <section class="panel wide form-layout">
      <div>
        <p class="eyebrow">Payments</p>
        <h2>الدفع الإلكتروني</h2>
        <p class="muted">واجهة الدفع جاهزة كتصميم، لكن التفعيل الحقيقي يحتاج حساب مزود دفع ومراجعة شروطه لنشاط الشركة وبلد التشغيل.</p>
      </div>
      <div class="payment-box">
        <strong>${escapeHtml(appConfig.paymentStatus)}</strong>
        <p>المرحلة التالية: اختيار مزود دفع مناسب، ثم وضع مفاتيح الاختبار في بيئة آمنة، وليس داخل الواجهة.</p>
        <button class="button primary" type="button" disabled>الدفع غير مفعل بعد</button>
      </div>
    </section>
  `);
}

function statusCard(item) {
  return `
    <article class="status-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.trend)}</small>
    </article>
  `;
}

function taskItem(item) {
  const checked = state.completed.has(item.id);
  return `
    <button class="task-item ${checked ? "done" : ""}" data-task="${escapeHtml(item.id)}">
      <span class="task-check">${checked ? "✓" : ""}</span>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
        <em class="task-action">${checked ? "مفعلة" : "اضغط لتفعيل هذه الميزة"}</em>
      </span>
    </button>
  `;
}

function requestCard(request) {
  const nextStatus = request.status === "مغلق" ? "مفتوح" : "مغلق";
  return `
    <article class="request-card">
      <div>
        <strong>${escapeHtml(request.publicId || request.id)} - ${escapeHtml(request.customer)}</strong>
        <span>${escapeHtml(request.channel)} / ${escapeHtml(request.type)}</span>
      </div>
      <p>${escapeHtml(request.note)}</p>
      <div class="request-actions">
        <span class="status-chip">${escapeHtml(request.status)}</span>
        <button type="button" data-request="${escapeHtml(request.id)}" data-status="${nextStatus}">
          ${request.status === "مغلق" ? "إعادة فتح" : "إغلاق"}
        </button>
      </div>
    </article>
  `;
}

function render() {
  const pages = {
    overview,
    login,
    requests,
    remote,
    monitoring,
    payments
  };

  app.innerHTML = pages[state.route]();

  app.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setRoute(button.dataset.route);
    });
  });

  app.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", () => toggleItem(button.dataset.task));
  });

  app.querySelector("[data-action='install']")?.addEventListener("click", installApp);
  app.querySelector("[data-action='logout']")?.addEventListener("click", logout);

  app.querySelector("[data-form='login']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSession(event.currentTarget, event.submitter?.dataset.authAction || "signin");
  });

  app.querySelector("[data-form='request']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    addRequest(event.currentTarget);
  });

  app.querySelectorAll("[data-request]").forEach((button) => {
    button.addEventListener("click", () => updateRequest(button.dataset.request, button.dataset.status));
  });
}

boot();
