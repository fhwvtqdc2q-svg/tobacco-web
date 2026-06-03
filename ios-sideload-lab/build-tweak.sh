#!/usr/bin/env bash
# build-tweak.sh — يبني MyTweak.dylib تلقائياً عبر Theos داخل WSL/لينكس
#
# يفعل كل شيء بأمر واحد:
#   1) يثبّت Theos إن لم يكن موجوداً (مع أدوات البناء وSDK)
#   2) يبني example-tweak/ إلى MyTweak.dylib
#   3) ينسخ الناتج إلى مجلد ios-lab على سطح مكتب ويندوز (إن وُجد عبر WSL)
#
# الاستخدام (داخل WSL/أوبنتو، من جذر مجلد ios-sideload-lab):
#   bash build-tweak.sh
#
# ⚖️ للاستخدام التعليمي على تطبيقاتك أو المفتوحة المصدر (PPSSPP) فقط.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TWEAK_DIR="$SCRIPT_DIR/example-tweak"

echo "=================================================="
echo "   بناء MyTweak.dylib عبر Theos"
echo "=================================================="

# ---------------------------------------------------------------------------
# 1) المتطلبات الأساسية
# ---------------------------------------------------------------------------
echo "[1/4] التحقق من الأدوات الأساسية (git, make, curl, perl)..."
NEED=()
for tool in git make curl perl; do
    command -v "$tool" >/dev/null 2>&1 || NEED+=("$tool")
done
if [ ${#NEED[@]} -gt 0 ]; then
    echo "    تثبيت: ${NEED[*]}"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq build-essential "${NEED[@]}" fakeroot zip
    else
        echo "    !! ثبّت يدوياً: ${NEED[*]}" >&2
        exit 1
    fi
fi
echo "    OK"

# ---------------------------------------------------------------------------
# 2) تثبيت Theos إن لزم
# ---------------------------------------------------------------------------
echo "[2/4] التحقق من Theos..."
if [ -z "${THEOS:-}" ]; then
    if [ -d "$HOME/theos" ]; then
        export THEOS="$HOME/theos"
    else
        echo "    تثبيت Theos لأول مرة (قد يستغرق دقائق)..."
        export THEOS="$HOME/theos"
        bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)" || {
            echo "    !! فشل تثبيت Theos تلقائياً. ثبّته يدوياً من https://theos.dev/docs/installation" >&2
            exit 1
        }
    fi
fi
echo "    THEOS = $THEOS"

# تأكد من وجود SDK (يحتاج Theos إلى iOS SDK في \$THEOS/sdks)
if [ -z "$(ls -A "$THEOS/sdks" 2>/dev/null || true)" ]; then
    echo "    تنزيل iOS SDKs..."
    git clone --depth 1 https://github.com/theos/sdks.git "$THEOS/sdks" 2>/dev/null || \
        echo "    !! نزّل SDK يدوياً إلى $THEOS/sdks إن فشل البناء."
fi
echo "    OK"

# ---------------------------------------------------------------------------
# 3) البناء
# ---------------------------------------------------------------------------
echo "[3/4] بناء المكتبة..."
cd "$TWEAK_DIR"
make clean >/dev/null 2>&1 || true
make

DYLIB="$TWEAK_DIR/.theos/obj/MyTweak.dylib"
if [ ! -f "$DYLIB" ]; then
    # بعض إصدارات Theos تضع الناتج في مسار مختلف
    DYLIB="$(find "$TWEAK_DIR/.theos" -name 'MyTweak.dylib' 2>/dev/null | head -n1)"
fi
[ -f "$DYLIB" ] || { echo "    !! لم يُعثر على MyTweak.dylib بعد البناء." >&2; exit 1; }
echo "    OK: $DYLIB"

# ---------------------------------------------------------------------------
# 4) نسخ الناتج إلى مجلد ios-lab على سطح مكتب ويندوز (إن أمكن)
# ---------------------------------------------------------------------------
echo "[4/4] نسخ الناتج..."
cp "$DYLIB" "$SCRIPT_DIR/MyTweak.dylib"
echo "    نُسخت إلى: $SCRIPT_DIR/MyTweak.dylib"

# محاولة العثور على Desktop\ios-lab عبر WSL
for base in /mnt/c/Users/*/Desktop/ios-lab; do
    if [ -d "$base" ]; then
        cp "$DYLIB" "$base/MyTweak.dylib"
        echo "    نُسخت أيضاً إلى مجلد ويندوز: $base/MyTweak.dylib"
    fi
done

echo ""
echo "=================================================="
echo "   تم بناء MyTweak.dylib بنجاح ✅"
echo "=================================================="
echo "الخطوة التالية على ويندوز (داخل مجلد ios-lab):"
echo "    python inject_dylib.py PPSSPP.ipa MyTweak.dylib"
echo ""
echo "⚖️  للتطبيقات الخاصة بك أو المفتوحة المصدر (PPSSPP) فقط."
