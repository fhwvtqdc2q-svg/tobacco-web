"""
اكتشاف جداول قاعدة بيانات الأمين
شغّل هذا الملف أولاً لمعرفة أسماء الجداول الصحيحة
"""
import json, sys, os

try:
    import pyodbc
except ImportError:
    print("pyodbc غير مثبت. شغّل: pip install pyodbc")
    sys.exit(1)

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

def load_config():
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def connect(cfg):
    s = cfg["sql_server"]
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={s['server']};"
        f"DATABASE={s['database']};"
    )
    if s.get("windows_auth", True):
        conn_str += "Trusted_Connection=yes;"
    else:
        conn_str += f"UID={s['username']};PWD={s['password']};"
    return pyodbc.connect(conn_str)

def main():
    cfg = load_config()
    print(f"\nالاتصال بـ: {cfg['sql_server']['server']} / {cfg['sql_server']['database']}\n")

    conn = connect(cfg)
    cursor = conn.cursor()

    # الجداول والـ Views المحتملة للمخزون
    keywords = ["stock", "item", "مادة", "مواد", "مخزون", "صنف", "أصناف", "balance", "qty", "quantity", "كمية", "جرد", "inventory"]

    print("=" * 60)
    print("الجداول والـ Views المتعلقة بالمخزون:")
    print("=" * 60)

    tables = cursor.tables(tableType="TABLE").fetchall()
    views  = cursor.tables(tableType="VIEW").fetchall()

    found = []
    for row in tables + views:
        name = row.table_name or ""
        if any(k.lower() in name.lower() for k in keywords):
            found.append((row.table_type, name))

    if found:
        for t_type, t_name in found:
            print(f"  [{t_type}]  {t_name}")
            try:
                cols = [c.column_name for c in cursor.columns(table=t_name).fetchall()]
                print(f"         الأعمدة: {', '.join(cols[:8])}{'...' if len(cols) > 8 else ''}")
            except Exception:
                pass
            print()
    else:
        print("لم أجد جداول بأسماء مألوفة. كل الجداول:")
        for row in tables[:30]:
            print(f"  {row.table_name}")

    print("=" * 60)
    print("\nبعد تحديد الجدول المناسب، عدّل inventory_query في config.json")
    print("مثال:")
    print('  "inventory_query": "SELECT ItemName AS \'اسم المادة\', Qty AS \'الكمية\' FROM dbo.اسم_الجدول WHERE Qty > 0"')

    conn.close()

if __name__ == "__main__":
    main()
