const appConfig = window.appConfig;
const roadmapItems = window.roadmapItems;
const platformChecks = window.platformChecks;
const monitoringCards = window.monitoringCards;
const remoteServices = window.remoteServices;

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

const state = {
  route: "overview",
  installPrompt: null,
  completed: new Set(readJson("completed-items", [])),
  session: readJson("tobacco-session", null),
  requests: readJson("tobacco-requests", [
    {
      id: "REQ-1001",
      customer: "عميل تجريبي",
      channel: "واتساب",
      type: "استفسار",
      status: "مفتوح",
      note: "طلب متابعة من فريق خدمة العملاء."
    }
  ])
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

function setRoute(route) {
  state.route = route;
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

function saveSession(form) {
  const data = new FormData(form);
  state.session = {
    name: data.get("name") || "موظف TOBACCO",
    role: data.get("role") || "خدمة العملاء"
  };
  writeJson("tobacco-session", state.session);
  setRoute("overview");
}

function logout() {
  state.session = null;
  writeJson("tobacco-session", null);
  render();
}

function addRequest(form) {
  const data = new FormData(form);
  const request = {
    id: `REQ-${Date.now().toString().slice(-5)}`,
    customer: data.get("customer") || "عميل جديد",
    channel: data.get("channel") || "ويب",
    type: data.get("type") || "طلب خدمة",
    status: "مفتوح",
    note: data.get("note") || "لا توجد ملاحظات"
  };
  state.requests = [request, ...state.requests];
  writeJson("tobacco-requests", state.requests);
  setRoute("requests");
}

function updateRequest(id, status) {
  state.requests = state.requests.map((request) =>
    request.id === id ? { ...request, status } : request
  );
  writeJson("tobacco-requests", state.requests);
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
          <span>${appConfig.name}</span>
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
            <p class="eyebrow">${appConfig.tagline}</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="topbar-actions">
            ${state.installPrompt ? '<button class="button secondary" data-action="install">تثبيت</button>' : ""}
            ${state.session ? `<button class="button secondary" data-action="logout">${state.session.name}</button>` : ""}
            <a class="button primary" href="mailto:${appConfig.supportEmail}">الدعم</a>
          </div>
        </header>
        ${connectionNotice()}
        ${content}
      </main>
    </div>
  `;
}

function connectionNotice() {
  if (location.protocol !== "file:") return "";

  return `
    <section class="notice-panel">
      <strong>هذه نسخة محلية على اللابتوب.</strong>
      <span>للاستخدام من الآيفون افتح رابط Cloudflare أو رابط الشبكة الذي يبدأ بـ <code>http://172...</code>. لا تستخدم رابط <code>file:///C:/...</code> على الآيفون.</span>
    </section>
  `;
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
        <p>${appConfig.description}</p>
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
            <strong>24/7</strong>
            <span>متابعة ممكنة</span>
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
          <li>افتح صفحة تسجيل الدخول وسجل دخولاً تجريبياً.</li>
          <li>أضف طلب عميل من صفحة طلبات العملاء.</li>
          <li>راجع صفحة المراقبة لمعرفة حالة العمل.</li>
          <li>اترك الدفع كواجهة فقط إلى أن نختار مزوداً مناسباً.</li>
        </ol>
      </article>
    </section>
  `);
}

function login() {
  return shell(`
    <section class="panel wide form-layout">
      <div>
        <p class="eyebrow">Access</p>
        <h2>دخول الموظفين والإدارة</h2>
        <p class="muted">هذا تسجيل دخول تجريبي محلي. الربط الحقيقي سيكون لاحقاً مع قاعدة بيانات ومزود مصادقة.</p>
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
        <button class="button primary" type="submit">دخول تجريبي</button>
        ${state.session ? `<p class="success-note">أنت داخل الآن باسم ${state.session.name} - ${state.session.role}</p>` : ""}
      </form>
    </section>
  `);
}

function requests() {
  return shell(`
    <section class="content-grid request-layout">
      <article class="panel">
        <h3>إضافة طلب عميل</h3>
        <form class="form-card compact" data-form="request">
          <label>
            اسم العميل
            <input name="customer" placeholder="اسم العميل أو رقم الطلب">
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
            <textarea name="note" rows="4" placeholder="اكتب ملخص الطلب"></textarea>
          </label>
          <button class="button primary" type="submit">حفظ الطلب</button>
        </form>
      </article>
      <article class="panel">
        <h3>سجل الطلبات</h3>
        <div class="request-list">
          ${state.requests.map(requestCard).join("")}
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
        ${remoteServices.map((service) => `<article><strong>${service}</strong><p>جاهزة كواجهة تشغيل، وتحتاج ربط قاعدة بيانات عند النشر.</p></article>`).join("")}
      </div>
    </section>
  `);
}

function monitoring() {
  return shell(`
    <section class="panel wide">
      <div class="section-head">
        <div>
          <p class="eyebrow">Monitoring</p>
          <h2>مراقبة خدمة العملاء</h2>
        </div>
      </div>
      <div class="status-board full">
        ${monitoringCards.map(statusCard).join("")}
      </div>
      <div class="audit-note">
        <strong>ملاحظة تشغيلية:</strong>
        <span>هذه المؤشرات تجريبية الآن. عند ربط قاعدة البيانات سنجعلها تقرأ الطلبات الحقيقية وحالة الموظفين.</span>
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
        <strong>${appConfig.paymentStatus}</strong>
        <p>المرحلة التالية: اختيار مزود دفع مناسب، ثم وضع مفاتيح الاختبار في ملف بيئة آمن، وليس داخل الواجهة.</p>
        <button class="button primary" type="button" disabled>الدفع غير مفعل بعد</button>
      </div>
    </section>
  `);
}

function statusCard(item) {
  return `
    <article class="status-card">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <small>${item.trend}</small>
    </article>
  `;
}

function taskItem(item) {
  const checked = state.completed.has(item.id);
  return `
    <button class="task-item ${checked ? "done" : ""}" data-task="${item.id}">
      <span class="task-check">${checked ? "✓" : ""}</span>
      <span>
        <strong>${item.title}</strong>
        <small>${item.detail}</small>
        <em class="task-action">${checked ? "مفعلة" : "اضغط لتفعيل هذه الميزة"}</em>
      </span>
    </button>
  `;
}

function requestCard(request) {
  return `
    <article class="request-card">
      <div>
        <strong>${request.id} - ${request.customer}</strong>
        <span>${request.channel} / ${request.type}</span>
      </div>
      <p>${request.note}</p>
      <div class="request-actions">
        <span class="status-chip">${request.status}</span>
        <button type="button" data-request="${request.id}" data-status="${request.status === "مغلق" ? "مفتوح" : "مغلق"}">
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
    saveSession(event.currentTarget);
  });

  app.querySelector("[data-form='request']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    addRequest(event.currentTarget);
  });

  app.querySelectorAll("[data-request]").forEach((button) => {
    button.addEventListener("click", () => updateRequest(button.dataset.request, button.dataset.status));
  });
}

render();
