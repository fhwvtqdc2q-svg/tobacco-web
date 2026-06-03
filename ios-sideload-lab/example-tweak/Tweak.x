// Tweak.x — مثال تعليمي بسيط لمكتبة iOS (تُبنى إلى .dylib عبر Theos)
//
// يطبع رسالة في سجل الجهاز عند إقلاع أي تطبيق حُقنت فيه هذه المكتبة،
// ويعترض دالة UIApplication ليُظهر متى أصبح التطبيق نشطاً.
//
// هذا للتعلّم فقط — طبّقه على تطبيقك الخاص أو تطبيق مفتوح المصدر.

#import <UIKit/UIKit.h>

// (1) يُنفَّذ فور تحميل المكتبة عند بدء العملية (قبل أي شيء آخر تقريباً)
__attribute__((constructor))
static void tweakInit(void) {
    NSLog(@"[MyTweak] 🎉 تم حقن المكتبة بنجاح! العملية: %@",
          [[NSProcessInfo processInfo] processName]);
}

// (2) اعتراض (Hook) لدالة في UIApplication — أسلوب Logos الخاص بـ Theos
%hook UIApplicationDelegate

- (void)applicationDidBecomeActive:(UIApplication *)application {
    %orig;  // نستدعي الأصل أولاً حتى لا نكسر سلوك التطبيق
    NSLog(@"[MyTweak] التطبيق أصبح نشطاً الآن ✅");
}

%end
