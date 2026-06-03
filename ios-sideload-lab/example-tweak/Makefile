# Makefile — يبني Tweak.x إلى مكتبة .dylib باستخدام Theos
#
# يُبنى كـ "library" (وليس tweak تقليدي يُثبّت على جهاز مكسور الحماية)،
# حتى نحصل على ملف .dylib مستقل يمكن حقنه في IPA عبر inject_dylib.py.
#
# التشغيل (داخل WSL/لينكس/ماك بعد تثبيت Theos):
#   make
# الناتج: .theos/obj/MyTweak.dylib

TARGET := iphone:clang:latest:14.0
ARCHS  := arm64 arm64e

include $(THEOS)/makefiles/common.mk

LIBRARY_NAME = MyTweak

MyTweak_FILES        = Tweak.x
MyTweak_FRAMEWORKS   = UIKit Foundation
MyTweak_CFLAGS       = -fobjc-arc
# الاسم الداخلي للمكتبة يجب أن يكون مساراً نسبياً يفهمه التطبيق المضيف:
MyTweak_LDFLAGS      = -install_name @executable_path/Frameworks/MyTweak.dylib

include $(THEOS_MAKE_PATH)/library.mk
