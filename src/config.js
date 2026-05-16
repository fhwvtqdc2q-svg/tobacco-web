window.appConfig = {
  name: "TOBACCO",
  supportEmail: "ozk.kh@outlook.com",
  tagline: "منصة خدمة عملاء وإدارة عن بعد",
  description:
    "لوحة ويب عربية لإدارة طلبات العملاء، متابعة العمل عن بعد، مراقبة الحالة، وتجهيز الدفع الإلكتروني عند اختيار مزود مناسب.",
  language: "ar",
  paymentStatus: "واجهة جاهزة للربط"
};

window.roadmapItems = [
  {
    id: "login",
    title: "تسجيل الدخول",
    detail: "واجهة دخول عربية للموظفين والإدارة، جاهزة للربط مع Supabase أو Firebase."
  },
  {
    id: "requests",
    title: "طلبات العملاء",
    detail: "تسجيل طلبات العملاء وحفظها محلياً أثناء التطوير قبل ربط قاعدة البيانات."
  },
  {
    id: "remote",
    title: "الإدارة عن بعد",
    detail: "متابعة مهام الدعم، الفروع، وقنوات التواصل من أي جهاز."
  },
  {
    id: "monitoring",
    title: "المراقبة",
    detail: "مؤشرات تشغيلية للطلبات المفتوحة، سرعة الاستجابة، وحالة الخدمات."
  },
  {
    id: "payments",
    title: "الدفع",
    detail: "واجهة دفع مبدئية. الربط الحقيقي يحتاج مزود دفع يقبل نشاط الشركة وقواعد بلدك."
  },
  {
    id: "hosting",
    title: "النشر",
    detail: "جاهز للنشر لاحقاً على خادم سحابي أو منصة استضافة ويب."
  }
];

window.platformChecks = [
  {
    name: "Windows",
    status: "جاهز",
    detail: "يعمل من Edge أو Chrome على اللابتوب."
  },
  {
    name: "iPhone",
    status: "جاهز عبر الرابط العام",
    detail: "افتح رابط Cloudflare أو رابط الشبكة من Safari."
  },
  {
    name: "Mac",
    status: "جاهز",
    detail: "يعمل من Safari أو Chrome بدون Xcode."
  },
  {
    name: "Android",
    status: "مدعوم",
    detail: "يعمل من Chrome ويمكن تثبيته كتطبيق ويب."
  }
];

window.monitoringCards = [
  { label: "طلبات مفتوحة", value: "12", trend: "تحتاج متابعة" },
  { label: "زمن الرد", value: "8 د", trend: "جيد" },
  { label: "قنوات نشطة", value: "3", trend: "واتساب، هاتف، ويب" },
  { label: "حالة النظام", value: "مستقر", trend: "لا توجد أعطال" }
];

window.remoteServices = [
  "متابعة طلبات العملاء من الهاتف والكمبيوتر",
  "توزيع الطلبات على الموظفين",
  "مراقبة حالة الدعم والفروع",
  "تجهيز تقارير يومية للإدارة"
];
