"""
OZK TOBACCO — Ameen SQL Agent
يتصل بقاعدة بيانات الأمين ويرسل الجرد تلقائياً إلى Supabase
"""
import json, sys, os, re, urllib.request, urllib.error
from datetime import datetime, date

try:
    import pyodbc
except ImportError:
    print("pyodbc غير مثبت. شغّل: pip install pyodbc")
    sys.exit(1)

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")
LOG_FILE    = os.path.join(os.path.dirname(__file__), "sync.log")


def log(msg):
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_config():
    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def connect_sql(s):
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={s['server']};"
        f"DATABASE={s['database']};"
    )
    if s.get("windows_auth", True):
        conn_str += "Trusted_Connection=yes;"
    else:
        conn_str += f"UID={s['username']};PWD={s['password']};"
    return pyodbc.connect(conn_str, timeout=10)


def normalize_key(name):
    if not name:
        return ""
    name = str(name).strip()
    name = re.sub(r'[ؐ-ًؚ-ٟ]', '', name)
    name = re.sub(r'[أإآ]', 'ا', name)
    name = re.sub(r'ة', 'ه', name)
    name = re.sub(r'ى', 'ي', name)
    name = re.sub(r'\s+', ' ', name)
    return name.strip().lower()


def fetch_rows(conn, query):
    cur = conn.cursor()
    cur.execute(query)
    cols = [c[0] for c in cur.description]
    return cols, cur.fetchall()


def build_report(cols, rows, cfg):
    name_col = cfg.get("column_item_name", "اسم المادة")
    qty_col  = cfg.get("column_quantity",  "الكمية")
    unit_col = cfg.get("column_unit",      "الوحدة")
    threshold = int(cfg.get("low_stock_threshold", 50))

    idx = {c: i for i, c in enumerate(cols)}

    if name_col not in idx:
        raise ValueError(
            f"العمود '{name_col}' غير موجود. الأعمدة المتاحة: {', '.join(cols)}"
        )

    items = []
    for row in rows:
        name = str(row[idx[name_col]] or "").strip()
        if not name:
            continue
        qty = float(row[idx[qty_col]] or 0) if qty_col in idx else 0.0
        unit = str(row[idx[unit_col]] or "").strip() if unit_col in idx else ""

        if qty <= 0:
            status = "out"
        elif qty <= threshold:
            status = "low"
        else:
            status = "active"

        items.append({
            "key":      normalize_key(name),
            "name":     name,
            "stockQty": round(qty, 3),
            "unit":     unit,
            "status":   status,
        })

    today = date.today().isoformat()
    summary = {
        "source":          "ameen_sql_agent",
        "reportDate":      today,
        "totalStockItems": len(items),
        "availableItems":  sum(1 for i in items if i["stockQty"] > 0),
        "outOfStockItems": sum(1 for i in items if i["stockQty"] <= 0),
        "lowStockItems":   sum(1 for i in items if i["status"] == "low"),
        "activeItems":     sum(1 for i in items if i["status"] == "active"),
        "staleItems":      0,
        "threshold":       threshold,
    }

    return {
        "source":      "ameen_sql_agent",
        "report_date": today,
        "summary":     summary,
        "items":       items,
    }


def post_to_supabase(sb_cfg, table, payload):
    url  = f"{sb_cfg['url'].rstrip('/')}/rest/v1/{table}"
    body = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        url, data=body,
        headers={
            "Content-Type":  "application/json",
            "apikey":        sb_cfg["key"],
            "Authorization": f"Bearer {sb_cfg['key']}",
            "Prefer":        "return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase HTTP {e.code}: {body_err[:300]}")


def main():
    log("══ بدء مزامنة الأمين ══")
    try:
        cfg = load_config()

        if not cfg.get("inventory_query"):
            log("خطأ: inventory_query فارغة في config.json")
            log("شغّل discover.py أولاً لمعرفة اسم الجدول الصحيح")
            sys.exit(1)

        log(f"الاتصال بـ {cfg['sql_server']['server']} / {cfg['sql_server']['database']}")
        conn = connect_sql(cfg["sql_server"])

        log("تنفيذ الاستعلام...")
        cols, rows = fetch_rows(conn, cfg["inventory_query"])
        conn.close()
        log(f"تم قراءة {len(rows)} صف من قاعدة البيانات")

        report = build_report(cols, rows, cfg)
        log(f"الجرد: {report['summary']['availableItems']} متوفرة / "
            f"{report['summary']['lowStockItems']} قريبة النفاد / "
            f"{report['summary']['outOfStockItems']} نفدت")

        status = post_to_supabase(cfg["supabase"], cfg["supabase"]["table"], report)
        log(f"✓ أُرسل إلى Supabase (HTTP {status})")

    except Exception as exc:
        log(f"✗ فشل: {exc}")
        sys.exit(1)

    log("══ انتهت المزامنة بنجاح ══\n")


if __name__ == "__main__":
    main()
