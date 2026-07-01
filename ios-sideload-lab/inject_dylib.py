#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inject_dylib.py — أداة تعليمية لحقن مكتبة ديناميكية (.dylib) داخل تطبيق iOS (.ipa)

تعمل على ويندوز / لينكس / ماك بـ Python وحده، بدون أدوات Apple (otool / install_name_tool).

ما تفعله الأداة:
  1) تفكّ ضغط الـ IPA (وهو أصلاً أرشيف ZIP).
  2) تنسخ ملف الـ .dylib إلى مجلد Payload/<App>.app/Frameworks/.
  3) تضيف أمر تحميل LC_LOAD_DYLIB إلى رأس الملف التنفيذي (Mach-O) ليُحمّل
     مكتبتك عند إقلاع التطبيق:  @executable_path/Frameworks/<اسم المكتبة>.
  4) تعيد تغليف كل شيء في IPA جديد.

⚠️  مهم جداً — التوقيع:
    الـ IPA الناتج يصبح **بلا توقيع صالح** بعد التعديل. يجب أن تمرّره عبر
    Sideloadly أو AltStore على جهازك، فهو يعيد توقيعه بحساب Apple ID الخاص بك
    قبل التثبيت على الآيفون. هذه الأداة لا توقّع ولا تُثبّت — فقط تحقن.

⚖️  الاستخدام القانوني فقط:
    طبّق هذا على تطبيقك الخاص أو على تطبيق مفتوح المصدر تملك حق تعديله.
    لا تستخدمه لتعديل تطبيقات تجارية محمية بحقوق نشر.

طريقة التشغيل (من نافذة الأوامر CMD / PowerShell على ويندوز):
    python inject_dylib.py  MyApp.ipa  MyTweak.dylib
    python inject_dylib.py  MyApp.ipa  MyTweak.dylib  -o MyApp-patched.ipa

المتطلبات: Python 3.8+ فقط (لا حزم خارجية).
"""

import argparse
import os
import shutil
import struct
import sys
import tempfile
import zipfile

# ---------------------------------------------------------------------------
# ثوابت Mach-O
# ---------------------------------------------------------------------------
MH_MAGIC_64 = 0xFEEDFACF   # ملف Mach-O 64-bit، نفس ترتيب البايتات
MH_CIGAM_64 = 0xCFFAEDFE   # ملف Mach-O 64-bit، ترتيب بايتات معكوس
MH_MAGIC_32 = 0xFEEDFACE   # 32-bit
MH_CIGAM_32 = 0xECFAEDFE

FAT_MAGIC = 0xCAFEBABE     # أرشيف Fat (متعدد المعماريات)، big-endian
FAT_CIGAM = 0xBEBAFECA

LC_LOAD_DYLIB = 0x0C       # نوع أمر تحميل مكتبة ديناميكية


def _align(value, alignment):
    """يقرّب value للأعلى لأقرب مضاعف من alignment."""
    remainder = value % alignment
    return value if remainder == 0 else value + (alignment - remainder)


def _patch_thin_macho(buf, slice_off, slice_size, dylib_path):
    """
    يضيف أمر LC_LOAD_DYLIB إلى شريحة Mach-O واحدة داخل buf (bytearray).
    slice_off  : إزاحة بداية الشريحة داخل buf (0 إذا كان الملف thin).
    slice_size : حجم الشريحة (للتأكد من عدم تجاوز الحدود).
    يُرجع True إذا نجح الحقن، أو يرفع استثناءً عند الخطأ.
    """
    magic = struct.unpack_from("<I", buf, slice_off)[0]

    if magic in (MH_MAGIC_64, MH_CIGAM_64):
        is_64, endian = True, ("<" if magic == MH_MAGIC_64 else ">")
        header_size = 32          # mach_header_64
        pointer_align = 8
    elif magic in (MH_MAGIC_32, MH_CIGAM_32):
        is_64, endian = False, ("<" if magic == MH_MAGIC_32 else ">")
        header_size = 28          # mach_header
        pointer_align = 4
    else:
        raise ValueError(f"ليست شريحة Mach-O صالحة (magic=0x{magic:08X})")

    # ترويسة Mach-O: magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags [,reserved]
    ncmds_off = slice_off + 16
    sizeofcmds_off = slice_off + 20
    ncmds = struct.unpack_from(endian + "I", buf, ncmds_off)[0]
    sizeofcmds = struct.unpack_from(endian + "I", buf, sizeofcmds_off)[0]

    load_cmds_start = slice_off + header_size
    load_cmds_end = load_cmds_start + sizeofcmds

    # تحقّق: هل المكتبة محقونة مسبقاً؟ نمرّ على أوامر التحميل.
    target_name = b"@executable_path/Frameworks/" + os.path.basename(dylib_path).encode()
    cursor = load_cmds_start
    min_section_off = slice_size  # أصغر إزاحة لبيانات قسم/مقطع (داخل الشريحة)
    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from(endian + "II", buf, cursor)
        if cmdsize == 0:
            raise ValueError("أمر تحميل بحجم صفر — ملف تالف")
        if cmd in (LC_LOAD_DYLIB, 0x0D, 0x0E, 0x0F, 0x18, 0x1F):  # أنواع dylib المختلفة
            name_ofs = struct.unpack_from(endian + "I", buf, cursor + 8)[0]
            raw = buf[cursor + name_ofs: cursor + cmdsize]
            if target_name in raw:
                print(f"   ℹ️  المكتبة محقونة مسبقاً، تخطّي هذه الشريحة.")
                return False
        # تتبّع أصغر إزاحة بيانات لمعرفة المساحة المتاحة لأوامر التحميل
        if cmd in (0x01, 0x19):  # LC_SEGMENT (0x1) / LC_SEGMENT_64 (0x19)
            if cmd == 0x19:
                fileoff = struct.unpack_from(endian + "Q", buf, cursor + 32)[0]
                nsects = struct.unpack_from(endian + "I", buf, cursor + 64)[0]
            else:
                fileoff = struct.unpack_from(endian + "I", buf, cursor + 32)[0]
                nsects = struct.unpack_from(endian + "I", buf, cursor + 48)[0]
            # نتجاهل المقاطع الفارغة (fileoff=0 وnsects=0 مثل __PAGEZERO)
            if fileoff != 0 or nsects != 0:
                if 0 < fileoff < min_section_off:
                    min_section_off = fileoff
        cursor += cmdsize

    # بناء أمر LC_LOAD_DYLIB الجديد
    #   struct dylib_command { cmd; cmdsize; name_offset; timestamp; cur_ver; compat_ver; }  ثم الاسم
    name_bytes = target_name + b"\x00"
    cmdsize = _align(24 + len(name_bytes), pointer_align)
    new_cmd = struct.pack(
        endian + "IIIIII",
        LC_LOAD_DYLIB,   # cmd
        cmdsize,         # cmdsize
        24,              # name offset داخل الأمر
        0,               # timestamp
        0,               # current_version
        0,               # compatibility_version
    )
    new_cmd += name_bytes
    new_cmd += b"\x00" * (cmdsize - len(new_cmd))  # حشو للمحاذاة

    # هل توجد مساحة فارغة كافية بين نهاية أوامر التحميل وبداية أول بيانات؟
    headroom = (slice_off + min_section_off) - load_cmds_end
    if headroom < cmdsize:
        raise ValueError(
            f"لا توجد مساحة كافية في رأس الملف لحقن الأمر "
            f"(متاح {headroom} بايت، مطلوب {cmdsize}). "
            f"جرّب أداة Sideloadly التي تتعامل مع هذه الحالة."
        )

    # اكتب الأمر الجديد، وحدّث ncmds و sizeofcmds
    buf[load_cmds_end: load_cmds_end + cmdsize] = new_cmd
    struct.pack_into(endian + "I", buf, ncmds_off, ncmds + 1)
    struct.pack_into(endian + "I", buf, sizeofcmds_off, sizeofcmds + cmdsize)
    return True


def patch_executable(path, dylib_path):
    """يفتح الملف التنفيذي (thin أو fat) ويحقن LC_LOAD_DYLIB في كل شريحة."""
    with open(path, "rb") as f:
        buf = bytearray(f.read())

    magic = struct.unpack_from(">I", buf, 0)[0]
    patched_any = False

    if magic in (FAT_MAGIC, FAT_CIGAM):
        # أرشيف Fat: ترويسة big-endian، يليها nfat_arch من البنى fat_arch
        nfat = struct.unpack_from(">I", buf, 4)[0]
        print(f"   ملف Fat يحوي {nfat} معمارية.")
        for i in range(nfat):
            # struct fat_arch { cputype; cpusubtype; offset; size; align; }  (كلها 32-bit، big-endian)
            arch_off = 8 + i * 20
            slice_off = struct.unpack_from(">I", buf, arch_off + 8)[0]
            slice_size = struct.unpack_from(">I", buf, arch_off + 12)[0]
            if _patch_thin_macho(buf, slice_off, slice_size, dylib_path):
                patched_any = True
    else:
        # ملف thin (شريحة واحدة) — وهو الشائع في تطبيقات iOS الحديثة (arm64)
        if _patch_thin_macho(buf, 0, len(buf), dylib_path):
            patched_any = True

    if patched_any:
        with open(path, "wb") as f:
            f.write(buf)
    return patched_any


def find_app_bundle(payload_dir):
    """يعثر على مجلد <App>.app داخل Payload/."""
    for name in os.listdir(payload_dir):
        if name.endswith(".app"):
            return os.path.join(payload_dir, name)
    raise FileNotFoundError("لم يُعثر على مجلد .app داخل Payload/ — هل الـ IPA سليم؟")


def get_executable_name(app_dir):
    """يقرأ اسم الملف التنفيذي من Info.plist (CFBundleExecutable)."""
    plist_path = os.path.join(app_dir, "Info.plist")
    try:
        import plistlib
        with open(plist_path, "rb") as f:
            info = plistlib.load(f)
        name = info.get("CFBundleExecutable")
        if name:
            return name
    except Exception:
        pass
    # احتياط: اسم التطبيق نفسه عادةً = اسم الملف التنفيذي
    return os.path.splitext(os.path.basename(app_dir))[0]


def main():
    parser = argparse.ArgumentParser(
        description="حقن مكتبة .dylib داخل ملف .ipa (لأغراض تعليمية وتطبيقاتك الخاصة فقط)."
    )
    parser.add_argument("ipa", help="مسار ملف الـ IPA المُدخل")
    parser.add_argument("dylib", help="مسار ملف الـ .dylib المراد حقنه")
    parser.add_argument("-o", "--output", help="مسار IPA الناتج (افتراضياً <اسم>-patched.ipa)")
    args = parser.parse_args()

    if not os.path.isfile(args.ipa):
        sys.exit(f"❌ الملف غير موجود: {args.ipa}")
    if not os.path.isfile(args.dylib):
        sys.exit(f"❌ الملف غير موجود: {args.dylib}")

    out_path = args.output or (os.path.splitext(args.ipa)[0] + "-patched.ipa")

    work = tempfile.mkdtemp(prefix="ipa_inject_")
    try:
        print(f"📦 [1/4] فكّ ضغط: {args.ipa}")
        with zipfile.ZipFile(args.ipa, "r") as z:
            z.extractall(work)

        payload = os.path.join(work, "Payload")
        if not os.path.isdir(payload):
            sys.exit("❌ لا يحتوي الـ IPA على مجلد Payload/ — ملف غير صالح.")

        app_dir = find_app_bundle(payload)
        print(f"   التطبيق: {os.path.basename(app_dir)}")

        # [2/4] نسخ المكتبة إلى Frameworks/
        frameworks = os.path.join(app_dir, "Frameworks")
        os.makedirs(frameworks, exist_ok=True)
        dest_dylib = os.path.join(frameworks, os.path.basename(args.dylib))
        shutil.copy2(args.dylib, dest_dylib)
        print(f"📚 [2/4] نُسخت المكتبة إلى Frameworks/{os.path.basename(args.dylib)}")

        # [3/4] حقن أمر التحميل في الملف التنفيذي
        exe_name = get_executable_name(app_dir)
        exe_path = os.path.join(app_dir, exe_name)
        if not os.path.isfile(exe_path):
            sys.exit(f"❌ الملف التنفيذي غير موجود: {exe_name}")
        print(f"🔧 [3/4] حقن LC_LOAD_DYLIB في الملف التنفيذي: {exe_name}")
        if patch_executable(exe_path, args.dylib):
            print("   ✅ تم حقن أمر التحميل.")
        else:
            print("   ⚠️  لم يُجرَ أي تعديل (ربما محقونة مسبقاً).")

        # [4/4] إعادة التغليف
        print(f"🗜️  [4/4] إعادة تغليف: {out_path}")
        if os.path.exists(out_path):
            os.remove(out_path)
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            for root, _dirs, files in os.walk(work):
                for fn in files:
                    full = os.path.join(root, fn)
                    arc = os.path.relpath(full, work)
                    z.write(full, arc)

        print("\n✅ تم! الناتج:", out_path)
        print("⚠️  الخطوة التالية على جهازك: مرّر هذا الملف عبر Sideloadly أو AltStore")
        print("    لإعادة توقيعه بحساب Apple ID الخاص بك ثم تثبيته على الآيفون.")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
