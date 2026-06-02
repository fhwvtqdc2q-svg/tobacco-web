"use strict";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `أنت مساعد دعم تقني متخصص اسمك "OZK Tech". مهمتك حل مشاكل الأجهزة والبرامج بأسلوب واضح ومنظم.

تتخصص في:
- Windows 10 و Windows 11
- iPhone و iOS
- مشاكل الشبكة والإنترنت (واي فاي، DNS، VPN، راوتر)
- التطبيقات العامة (كروم، أوفيس، واتساب، إيميل، إلخ)

أسلوبك في الحل:
1. اسأل سؤالاً أو سؤالين محددين لفهم المشكلة بدقة قبل تقديم الحل
2. عند تقديم الحل، اعطِ خطوات مرقمة وواضحة
3. إذا كانت هناك أكثر من طريقة للحل، ابدأ بالأسهل
4. استخدم كود أو أوامر عند الحاجة (مثل cmd أو PowerShell)
5. إذا لم تحل المشكلة بعد الخطوات، اقترح الخطوة التالية

تكلم دائماً بالعربية. كن واضحاً وعملياً. لا تعطِ شرحاً نظرياً طويلاً — ركّز على الحل.`;

const CATEGORIES = [
  {
    id: "windows",
    icon: "🪟",
    label: "ويندوز",
    problems: [
      "الجهاز بطيء جداً",
      "الشاشة الزرقاء (BSOD)",
      "تحديثات ويندوز عالقة",
      "فيروس أو برنامج مشبوه",
      "مستكشف الملفات لا يستجيب",
      "مشكلة في الصوت",
      "الطابعة لا تعمل",
      "ارتفاع استخدام CPU أو RAM"
    ]
  },
  {
    id: "iphone",
    icon: "📱",
    label: "آيفون",
    problems: [
      "البطارية تنفد بسرعة",
      "الآيفون بطيء",
      "تطبيق يتوقف باستمرار",
      "مشكلة في الاتصال أو الشبكة",
      "التخزين ممتلئ",
      "الشاشة لا تستجيب",
      "نسيت كلمة مرور Apple ID",
      "المكالمات لا تصل"
    ]
  },
  {
    id: "network",
    icon: "🌐",
    label: "الشبكة",
    problems: [
      "الواي فاي لا يتصل",
      "الإنترنت بطيء",
      "الراوتر لا يعمل",
      "مشكلة DNS",
      "VPN لا يعمل",
      "لا يمكن فتح مواقع معينة",
      "انقطاع متكرر في الإنترنت",
      "أجهزة لا تظهر في الشبكة"
    ]
  },
  {
    id: "apps",
    icon: "📦",
    label: "التطبيقات",
    problems: [
      "كروم بطيء أو يتجمد",
      "واتساب لا يزامن",
      "أوفيس لا يفتح الملفات",
      "الإيميل لا يستقبل رسائل",
      "يوتيوب لا يشغل الفيديو",
      "مشكلة في تثبيت برنامج",
      "البرنامج لا يُحذف",
      "ملف PDF لا يفتح"
    ]
  }
];

const QUICK_START = [
  { icon: "🐢", title: "جهازي بطيء", desc: "ويندوز أو آيفون", msg: "جهازي أصبح بطيئاً جداً مؤخراً" },
  { icon: "📶", title: "مشكلة إنترنت", desc: "واي فاي أو شبكة", msg: "عندي مشكلة في الاتصال بالإنترنت" },
  { icon: "🔵", title: "شاشة زرقاء", desc: "BSOD على ويندوز", msg: "ظهرت لي شاشة زرقاء على ويندوز" },
  { icon: "🔋", title: "بطارية سريعة النفاد", desc: "آيفون أو لابتوب", msg: "البطارية تنفد بشكل سريع جداً" }
];

const state = {
  messages: [],
  loading: false,
  activeCategory: null,
  apiKey: localStorage.getItem("ozk-tech-claude-key") || "",
  showKeyModal: !localStorage.getItem("ozk-tech-claude-key"),
  sidebarOpen: false
};

const app = document.getElementById("app");

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function formatMarkdown(text) {
  return text
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${escapeHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^(\d+)\.\s(.+)$/gm, "<li>$2</li>")
    .replace(/(<li>[\s\S]+?<\/li>)/g, "<ol>$1</ol>")
    .replace(/^[-•]\s(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<\/[ou]l>)/g, (m) => m.startsWith("<ol>") ? m : `<ul>${m}</ul>`)
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>");
}

function render() {
  app.innerHTML = buildHtml();
  bindEvents();
}

function buildHtml() {
  return `
    ${state.showKeyModal ? keyModalHtml() : ""}
    <div class="header">
      <div class="header-brand">
        <span class="logo">🔧</span>
        <div>
          <h1>OZK Tech Support</h1>
          <p>مساعد تقني بالذكاء الاصطناعي</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary btn-sm" id="clear-btn">مسح المحادثة</button>
        <button class="btn btn-secondary btn-sm" id="key-btn">🔑 المفتاح</button>
      </div>
    </div>
    <div class="layout">
      <aside class="sidebar ${state.sidebarOpen ? "open" : ""}">
        <div class="sidebar-title">الأقسام</div>
        ${CATEGORIES.map((cat) => `
          <button class="category-btn ${state.activeCategory === cat.id ? "active" : ""}" data-cat="${cat.id}">
            <span class="icon">${cat.icon}</span>
            <span>${cat.label}</span>
          </button>
        `).join("")}
        ${state.activeCategory ? `
          <div class="divider"></div>
          <div class="sidebar-title">مشاكل شائعة</div>
          ${(CATEGORIES.find((c) => c.id === state.activeCategory)?.problems || []).map((p) => `
            <button class="quick-problem" data-problem="${escapeHtml(p)}">
              <span>›</span> ${escapeHtml(p)}
            </button>
          `).join("")}
        ` : ""}
      </aside>
      <div class="chat-area">
        <div class="messages" id="messages">
          ${state.messages.length === 0 ? welcomeHtml() : state.messages.map(msgHtml).join("")}
          ${state.loading ? typingHtml() : ""}
        </div>
        <div class="input-bar">
          <div class="input-wrap">
            <textarea id="msg-input" placeholder="صف مشكلتك هنا…" rows="1"></textarea>
          </div>
          <button class="send-btn" id="send-btn" ${state.loading || !state.apiKey ? "disabled" : ""}>↑</button>
        </div>
      </div>
    </div>
  `;
}

function welcomeHtml() {
  return `
    <div class="welcome">
      <div class="big-icon">🔧</div>
      <h2>كيف يمكنني مساعدتك؟</h2>
      <p>صف مشكلتك التقنية وسأساعدك في حلها خطوة بخطوة.<br>يمكنك أيضاً الاختيار من الأقسام على اليسار.</p>
      <div class="quick-grid">
        ${QUICK_START.map((q) => `
          <button class="quick-card" data-quick="${escapeHtml(q.msg)}">
            <div class="qc-icon">${q.icon}</div>
            <div class="qc-title">${escapeHtml(q.title)}</div>
            <div class="qc-desc">${escapeHtml(q.desc)}</div>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function msgHtml(msg) {
  const isUser = msg.role === "user";
  return `
    <div class="msg ${isUser ? "user" : "assistant"}">
      <div class="msg-avatar">${isUser ? "👤" : "🤖"}</div>
      <div class="msg-bubble">${isUser ? escapeHtml(msg.content) : formatMarkdown(msg.content)}</div>
    </div>
  `;
}

function typingHtml() {
  return `
    <div class="msg assistant">
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
}

function keyModalHtml() {
  return `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <h2>🔑 مفتاح Claude API</h2>
        <p>لكي يعمل المساعد التقني تحتاج مفتاح Claude API من Anthropic. أدخله هنا وسيُحفظ على جهازك فقط.</p>
        <label>Claude API Key</label>
        <input type="password" id="key-input" placeholder="sk-ant-..." value="${escapeHtml(state.apiKey)}">
        <div class="modal-actions">
          ${state.apiKey ? `<button class="btn btn-danger btn-sm" id="clear-key-btn">حذف المفتاح</button>` : ""}
          <button class="btn btn-secondary" id="cancel-modal-btn" ${!state.apiKey ? "style='display:none'" : ""}>إلغاء</button>
          <button class="btn btn-primary" id="save-key-btn">حفظ والبدء</button>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  // Auto-resize textarea
  const input = document.getElementById("msg-input");
  if (input) {
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });
    input.focus();
  }

  document.getElementById("send-btn")?.addEventListener("click", () => {
    sendMessage(document.getElementById("msg-input")?.value || "");
  });

  document.getElementById("clear-btn")?.addEventListener("click", () => {
    state.messages = [];
    state.activeCategory = null;
    render();
  });

  document.getElementById("key-btn")?.addEventListener("click", () => {
    state.showKeyModal = true;
    render();
  });

  document.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeCategory = state.activeCategory === btn.dataset.cat ? null : btn.dataset.cat;
      render();
    });
  });

  document.querySelectorAll("[data-problem]").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.problem));
  });

  document.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => sendMessage(btn.dataset.quick));
  });

  // Modal events
  document.getElementById("save-key-btn")?.addEventListener("click", () => {
    const val = document.getElementById("key-input")?.value.trim();
    if (!val) return;
    state.apiKey = val;
    localStorage.setItem("ozk-tech-claude-key", val);
    state.showKeyModal = false;
    render();
  });

  document.getElementById("cancel-modal-btn")?.addEventListener("click", () => {
    state.showKeyModal = false;
    render();
  });

  document.getElementById("clear-key-btn")?.addEventListener("click", () => {
    state.apiKey = "";
    localStorage.removeItem("ozk-tech-claude-key");
    state.showKeyModal = true;
    render();
  });

  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget && state.apiKey) {
      state.showKeyModal = false;
      render();
    }
  });

  // Scroll to bottom
  const msgs = document.getElementById("messages");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

async function sendMessage(text) {
  text = text?.trim();
  if (!text || state.loading) return;
  if (!state.apiKey) {
    state.showKeyModal = true;
    render();
    return;
  }

  state.messages.push({ role: "user", content: text });
  state.loading = true;
  render();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": state.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: state.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `خطأ ${response.status}`);
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "لم أتلقَّ ردًا.";
    state.messages.push({ role: "assistant", content: reply });
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `**تعذر الاتصال:** ${error.message}\n\nتأكد من صحة مفتاح API ووجود رصيد في حساب Anthropic.`
    });
  }

  state.loading = false;
  render();
}

render();
