// Tweak.x — مثال تعليمي بسيط لمكتبة iOS (تُبنى إلى .dylib عبر Theos)
//
// يطبع رسالة في سجل الجهاز عند إقلاع أي تطبيق حُقنت فيه هذه المكتبة،
// ويراقب إشعار تنشيط التطبيق ليُظهر متى أصبح التطبيق نشطاً.
//
// هذا للتعلّم فقط — طبّقه على تطبيقك الخاص أو تطبيق مفتوح المصدر.

#import <UIKit/UIKit.h>

// (1) يُنفَّذ فور تحميل المكتبة عند بدء العملية (قبل أي شيء آخر تقريباً)
__attribute__((constructor))
static void tweakInit(void) {
    NSLog(@"[MyTweak] 🎉 تم حقن المكتبة بنجاح! العملية: %@",
          [[NSProcessInfo processInfo] processName]);
}

@interface MyTweakObserver : NSObject
@end

@implementation MyTweakObserver

- (void)applicationDidBecomeActive:(NSNotification *)notification {
    (void)notification;
    NSLog(@"[MyTweak] التطبيق أصبح نشطاً الآن ✅");
}

@end

static MyTweakObserver *gObserver;

// (2) نراقب إشعار دخول التطبيق للحالة النشطة بدل hook على بروتوكول.
__attribute__((constructor))
static void registerLifecycleObserver(void) {
    gObserver = [MyTweakObserver new];
    [[NSNotificationCenter defaultCenter] addObserver:gObserver
                                             selector:@selector(applicationDidBecomeActive:)
                                                 name:UIApplicationDidBecomeActiveNotification
                                               object:nil];
}
