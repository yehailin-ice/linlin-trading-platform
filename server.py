#!/usr/bin/env python3
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


PORT = int(os.environ.get("PORT", "5174"))
HOST = os.environ.get("HOST", "127.0.0.1")
TIMEOUT = 6
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("LINLIN_DATA_DIR", os.path.join(BASE_DIR, "data"))
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
SQLITE_PATH = os.path.join(DATA_DIR, "linlin-trading.sqlite")
SCHEMA_VERSION = 1


def ensure_storage():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with sqlite3.connect(SQLITE_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS account_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                checksum TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)",
            ("schemaVersion", str(SCHEMA_VERSION)),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_key TEXT UNIQUE,
                trade_date TEXT,
                trade_time TEXT,
                side TEXT,
                code TEXT,
                name TEXT,
                shares REAL,
                price REAL,
                fee REAL,
                pnl REAL,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS positions (
                code TEXT PRIMARY KEY,
                name TEXT,
                shares REAL,
                avg_cost REAL,
                price REAL,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS history_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day INTEGER,
                trade_date TEXT,
                equity REAL,
                position_pct REAL,
                mood REAL,
                ret REAL,
                payload TEXT NOT NULL
            )
            """
        )


def checksum_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def account_envelope(account):
    account_text = json.dumps(account, ensure_ascii=False, sort_keys=True)
    return {
        "app": "淋淋的实盘",
        "schemaVersion": SCHEMA_VERSION,
        "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "checksum": checksum_text(account_text),
        "account": account,
    }


def load_account_from_disk():
    ensure_storage()
    with sqlite3.connect(SQLITE_PATH) as conn:
        row = conn.execute(
            "SELECT payload FROM account_snapshots ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    payload = json.loads(row[0])
    return payload.get("account") or payload


def prune_backups(limit=30):
    if not os.path.isdir(BACKUP_DIR):
        return
    files = [
        os.path.join(BACKUP_DIR, name)
        for name in os.listdir(BACKUP_DIR)
        if name.startswith("linlin-") and name.endswith(".sqlite")
    ]
    files.sort(key=lambda path: os.path.getmtime(path), reverse=True)
    for old_path in files[limit:]:
        try:
            os.remove(old_path)
        except OSError:
            pass


def sync_relational_tables(conn, account):
    conn.execute("DELETE FROM trades")
    conn.execute("DELETE FROM positions")
    conn.execute("DELETE FROM history_points")
    for trade in account.get("trades", []):
        trade_text = json.dumps(trade, ensure_ascii=False, sort_keys=True)
        trade_key = "|".join([
            str(trade.get("type", "")),
            str(trade.get("date", "")),
            str(trade.get("time", "")),
            str(trade.get("code", "")),
            str(trade.get("price", "")),
            str(trade.get("shares", "")),
            str(trade.get("reason", "")),
        ])
        conn.execute(
            """
            INSERT OR REPLACE INTO trades(
                trade_key, trade_date, trade_time, side, code, name, shares, price, fee, pnl, payload
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade_key,
                trade.get("date"),
                trade.get("time"),
                trade.get("type"),
                trade.get("code"),
                trade.get("name"),
                safe_float(trade.get("shares")),
                safe_float(trade.get("price")),
                safe_float(trade.get("fee")),
                safe_float(trade.get("pnl")),
                trade_text,
            ),
        )
    for position in account.get("positions", []):
        position_text = json.dumps(position, ensure_ascii=False, sort_keys=True)
        conn.execute(
            """
            INSERT OR REPLACE INTO positions(code, name, shares, avg_cost, price, payload)
            VALUES(?, ?, ?, ?, ?, ?)
            """,
            (
                position.get("code"),
                position.get("name"),
                safe_float(position.get("shares")),
                safe_float(position.get("avgCost")),
                safe_float(position.get("price")),
                position_text,
            ),
        )
    for item in account.get("history", []):
        item_text = json.dumps(item, ensure_ascii=False, sort_keys=True)
        conn.execute(
            """
            INSERT INTO history_points(day, trade_date, equity, position_pct, mood, ret, payload)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item.get("day"),
                item.get("date"),
                safe_float(item.get("equity")),
                safe_float(item.get("positionPct")),
                safe_float(item.get("mood")),
                safe_float(item.get("ret")),
                item_text,
            ),
        )


def save_account_to_disk(account, create_backup=True):
    ensure_storage()
    envelope = account_envelope(account)
    payload_text = json.dumps(envelope, ensure_ascii=False, sort_keys=True)
    with sqlite3.connect(SQLITE_PATH) as conn:
        conn.execute(
            "INSERT INTO account_snapshots(created_at, checksum, payload) VALUES(?, ?, ?)",
            (envelope["savedAt"], envelope["checksum"], payload_text),
        )
        conn.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)",
            ("lastSavedAt", envelope["savedAt"]),
        )
        conn.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)",
            ("lastChecksum", envelope["checksum"]),
        )
        sync_relational_tables(conn, account)
    if create_backup:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        if os.path.exists(SQLITE_PATH):
            shutil.copy2(SQLITE_PATH, os.path.join(BACKUP_DIR, f"linlin-{stamp}.sqlite"))
        prune_backups()
    return envelope


def storage_status():
    ensure_storage()
    account = load_account_from_disk()
    saved_at = ""
    checksum = ""
    with sqlite3.connect(SQLITE_PATH) as conn:
        rows = dict(conn.execute("SELECT key, value FROM metadata").fetchall())
        saved_at = rows.get("lastSavedAt", "")
        checksum = rows.get("lastChecksum", "")
    backups = []
    if os.path.isdir(BACKUP_DIR):
        backups = sorted(os.listdir(BACKUP_DIR), reverse=True)[:10]
    return {
        "ok": True,
        "hasAccount": bool(account),
        "schemaVersion": SCHEMA_VERSION,
        "dataDir": DATA_DIR,
        "sqlite": SQLITE_PATH,
        "backupDir": BACKUP_DIR,
        "savedAt": saved_at,
        "checksum": checksum,
        "recentBackups": backups,
    }


def build_portable_zip():
    ensure_storage()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    zip_path = os.path.join(DATA_DIR, f"linlin-trading-portable-{stamp}.zip")
    include_files = [
        "index.html",
        "app.js",
        "styles.css",
        "server.py",
        "Dockerfile",
        "docker-compose.yml",
        "README-迁移说明.md",
        "DOCKER部署指南.md",
    ]
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name in include_files:
            path = os.path.join(BASE_DIR, name)
            if os.path.exists(path):
                bundle.write(path, name)
        if os.path.exists(SQLITE_PATH):
            bundle.write(SQLITE_PATH, "data/linlin-trading.sqlite")
        if os.path.isdir(BACKUP_DIR):
            for root, _, files in os.walk(BACKUP_DIR):
                for filename in files:
                    path = os.path.join(root, filename)
                    rel = os.path.relpath(path, DATA_DIR)
                    bundle.write(path, os.path.join("data", rel))
    return zip_path


def read_request_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    return json.loads(raw.decode("utf-8") or "{}")


def market_prefix(code):
    return "sh" if code.startswith("6") else "sz"


def tencent_symbol(code):
    if code == "000001":
        return "sh000001"
    if code == "000688":
        return "sh000688"
    if code in {"000300", "000905", "000852"}:
        return f"sh{code}"
    if code.startswith(("399", "159", "160", "161", "162", "163", "164", "165")):
        return f"sz{code}"
    return f"{market_prefix(code)}{code}"


def secid(code):
    return f"1.{code}" if code.startswith("6") else f"0.{code}"


def limit_up(prev_close):
    return round(prev_close * 1.1 + 1e-8, 2)


def safe_float(value):
    try:
        if value in (None, "", "-"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def request_bytes(url, referer="https://finance.sina.com.cn/"):
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
        },
    )
    with urlopen(req, timeout=TIMEOUT) as response:
        return response.read()


def request_text(url, encoding="utf-8", referer="https://finance.sina.com.cn/"):
    return request_bytes(url, referer=referer).decode(encoding, errors="ignore")


def request_text_with_curl(url):
    return subprocess.check_output(
        [
            "curl",
            "-L",
            "--max-time",
            str(TIMEOUT),
            "-A",
            "Mozilla/5.0",
            "-H",
            "Referer: https://quote.eastmoney.com/",
            "-H",
            "Accept: */*",
            url,
        ],
        text=True,
        stderr=subprocess.DEVNULL,
    )


def normalize_quote(code, name, price, prev_close, change_pct=None, provider=""):
    price = float(price)
    prev_close = float(prev_close)
    if change_pct is None:
        change_pct = ((price - prev_close) / prev_close) * 100 if prev_close else 0
    limit_price = limit_up(prev_close) if prev_close else None
    return {
        "code": code,
        "name": name,
        "price": round(price, 3),
        "prevClose": round(prev_close, 3),
        "changePct": round(float(change_pct), 2),
        "limitUpPrice": limit_price,
        "isLimitUp": bool(limit_price and (abs(price - limit_price) <= 0.02 or float(change_pct) >= 9.8)),
        "provider": provider,
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def fetch_eastmoney(codes):
    fields = "f12,f14,f2,f3,f18"
    query = f"/api/qt/ulist.np/get?fltt=2&secids={','.join(secid(code) for code in codes)}&fields={fields}"
    last_error = None
    payload = None
    for host in ("https://push2.eastmoney.com", "http://push2.eastmoney.com", "https://push2his.eastmoney.com"):
        try:
            payload = json.loads(request_text(host + query))
            break
        except Exception as exc:
            last_error = exc
    if payload is None:
        raise RuntimeError(last_error or "Eastmoney unavailable")
    rows = payload.get("data", {}).get("diff") or []
    quotes = []
    for row in rows:
        if row.get("f2") in (None, "-", 0):
            continue
        quotes.append(
            normalize_quote(
                str(row.get("f12")),
                str(row.get("f14")),
                row.get("f2"),
                row.get("f18"),
                row.get("f3"),
                "东方财富",
            )
        )
    if not quotes:
        raise RuntimeError("Eastmoney empty quotes")
    return quotes


def fetch_zhitu(codes):
    token = os.environ.get("ZHITU_TOKEN", "").strip()
    if not token:
        raise RuntimeError("ZHITU_TOKEN not configured")
    quotes = []
    errors = []
    for code in codes:
        for endpoint in ("ssjy", "time"):
            try:
                url = f"https://api.zhituapi.com/hs/real/{endpoint}/{code}?token={token}"
                payload = json.loads(request_text(url))
                row = payload[0] if isinstance(payload, list) and payload else payload
                price = row.get("p")
                prev_close = row.get("yc")
                if price in (None, 0, "") or prev_close in (None, 0, ""):
                    raise RuntimeError("empty price")
                quotes.append(
                    normalize_quote(
                        code,
                        row.get("mc") or code,
                        price,
                        prev_close,
                        row.get("pc"),
                        f"智兔数服-{endpoint}",
                    )
                )
                break
            except Exception as exc:
                errors.append(f"{code}/{endpoint}: {exc}")
    if not quotes:
        raise RuntimeError("Zhitu empty quotes; " + "; ".join(errors[:3]))
    return quotes


def fetch_tencent(codes):
    symbols = ",".join(tencent_symbol(code) for code in codes)
    text = request_text(f"https://qt.gtimg.cn/q={symbols}", encoding="gbk")
    quotes = []
    for match in re.finditer(r'v_(?:sh|sz)(\d{6})="([^"]*)"', text):
      code = match.group(1)
      parts = match.group(2).split("~")
      if len(parts) < 5 or not parts[3]:
          continue
      quote = normalize_quote(code, parts[1], parts[3], parts[4], provider="腾讯行情")
      if len(parts) > 47:
          quote.update(
              {
                  "open": safe_float(parts[5]),
                  "high": safe_float(parts[33]),
                  "low": safe_float(parts[34]),
                  "volume": safe_float(parts[36]),
                  "amount": safe_float(parts[37]),
                  "turnoverRate": safe_float(parts[38]),
                  "peTtm": safe_float(parts[39]),
                  "pb": safe_float(parts[46]),
                  "marketCap": safe_float(parts[45]),
              }
          )
      quotes.append(quote)
    if not quotes:
        raise RuntimeError("Tencent empty quotes")
    return quotes


def fetch_sina(codes):
    symbols = ",".join(f"{market_prefix(code)}{code}" for code in codes)
    text = request_text(f"https://hq.sinajs.cn/list={symbols}")
    quotes = []
    for match in re.finditer(r'var hq_str_(?:sh|sz)(\d{6})="([^"]*)"', text):
        code = match.group(1)
        parts = match.group(2).split(",")
        if len(parts) < 4 or not parts[3]:
            continue
        quotes.append(normalize_quote(code, parts[0], parts[3], parts[2], provider="新浪行情"))
    if not quotes:
        raise RuntimeError("Sina empty quotes")
    return quotes


def fetch_netease(codes):
    symbols = ",".join(f"{'0' if code.startswith('6') else '1'}{code}" for code in codes)
    text = request_text(f"https://api.money.126.net/data/feed/{symbols},money.api")
    payload_text = text.strip()
    if payload_text.startswith("_ntes_quote_callback("):
        payload_text = payload_text[len("_ntes_quote_callback(") : -2]
    payload = json.loads(payload_text)
    quotes = []
    for raw_code, row in payload.items():
        code = raw_code[-6:]
        price = row.get("price")
        prev_close = row.get("yestclose")
        if price in (None, 0, "") or prev_close in (None, 0, ""):
            continue
        quotes.append(normalize_quote(code, row.get("name", code), price, prev_close, provider="网易财经"))
    if not quotes:
        raise RuntimeError("Netease empty quotes")
    return quotes


def ths_code(code):
    return f"USHA{code}" if code.startswith("6") else f"USZA{code}"


def fetch_thsdk(codes):
    try:
        from thsdk import THS
    except Exception as exc:
        raise RuntimeError(f"thsdk not installed: {exc}")
    quotes = []
    with THS() as ths:
        for code in codes:
            response = ths.tick_level1(ths_code(code))
            if not getattr(response, "success", False) or not response.data:
                continue
            latest = response.data[-1]
            price = latest.get("价格")
            if price in (None, 0, ""):
                continue
            depth = ths.depth(ths_code(code))
            prev_close = None
            name = code
            if getattr(depth, "success", False) and depth.data:
                prev_close = depth.data[0].get("昨收价")
                name = depth.data[0].get("名称") or name
            if not prev_close:
                raise RuntimeError("thsdk missing previous close")
            quotes.append(normalize_quote(code, name, price, prev_close, provider="同花顺THSDK"))
    if not quotes:
        raise RuntimeError("THSDK empty quotes")
    return quotes


def fetch_quotes(codes):
    errors = []
    providers = (fetch_zhitu, fetch_tencent, fetch_eastmoney, fetch_sina, fetch_netease, fetch_thsdk)
    for provider in providers:
        try:
            quotes = provider(codes)
            found = {item["code"] for item in quotes}
            missing = [code for code in codes if code not in found]
            if missing:
                for fallback_provider in providers:
                    if fallback_provider is provider:
                        continue
                    try:
                        fallback = fallback_provider(missing)
                        quotes.extend(fallback)
                        found = {item["code"] for item in quotes}
                        missing = [code for code in codes if code not in found]
                        if not missing:
                            break
                    except Exception as exc:
                        errors.append(f"{fallback_provider.__name__} missing fallback: {exc}")
            return {"ok": True, "quotes": quotes, "errors": errors}
        except Exception as exc:
            errors.append(f"{provider.__name__}: {exc}")
    return {"ok": False, "quotes": [], "errors": errors}

def kline_secid(code):
    if code in {"000001", "000688"}:
        return f"1.{code}"
    if code.startswith("399"):
        return f"0.{code}"
    return secid(code)


def eastmoney_kline(code, period):
    klt_map = {
        "1": "1",
        "5": "5",
        "15": "15",
        "30": "30",
        "60": "60",
        "120": "120",
        "daily": "101",
        "weekly": "102",
        "monthly": "103",
    }
    klt = klt_map.get(period, "101")
    limit = "260" if klt in {"101", "102", "103"} else "240"
    query = (
        f"/api/qt/stock/kline/get?secid={kline_secid(code)}&fields1=f1,f2,f3,f4,f5,f6"
        "&fields2=f51,f52,f53,f54,f55,f56,f57,f58"
        f"&klt={klt}&fqt=1&end=20500101&lmt={limit}"
    )
    payload = None
    last_error = None
    for host in ("https://push2his.eastmoney.com", "https://push2.eastmoney.com", "http://push2his.eastmoney.com"):
        try:
            payload = json.loads(request_text(host + query, referer="https://quote.eastmoney.com/"))
            break
        except Exception as exc:
            last_error = exc
            try:
                payload = json.loads(request_text_with_curl(host + query))
                break
            except Exception as curl_exc:
                last_error = curl_exc
    if payload is None:
        raise RuntimeError(last_error or "Eastmoney kline unavailable")
    data = payload.get("data") or {}
    rows = data.get("klines") or []
    candles = []
    for item in rows:
        parts = item.split(",")
        if len(parts) < 7:
            continue
        candles.append({
            "time": parts[0],
            "open": safe_float(parts[1]),
            "close": safe_float(parts[2]),
            "high": safe_float(parts[3]),
            "low": safe_float(parts[4]),
            "volume": safe_float(parts[5]) or 0,
            "amount": safe_float(parts[6]) or 0,
            "changePct": safe_float(parts[8]) if len(parts) > 8 else None,
        })
    candles = [item for item in candles if item["open"] and item["close"] and item["high"] and item["low"]]
    if not candles:
        raise RuntimeError("Eastmoney kline empty")
    return {
        "ok": True,
        "code": code,
        "name": data.get("name") or code,
        "period": period,
        "candles": candles,
        "provider": "东方财富K线",
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def sina_symbol(code):
    if code.startswith("399"):
        return f"sz{code}"
    if code in {"000001", "000688"} or code.startswith("6"):
        return f"sh{code}"
    return f"sz{code}"


def sina_kline(code, period):
    scale_map = {
        "1": "1",
        "5": "5",
        "15": "15",
        "30": "30",
        "60": "60",
        "120": "240",
        "daily": "240",
        "weekly": "240",
        "monthly": "240",
    }
    scale = scale_map.get(period, "240")
    limit = 260 if period in {"daily", "weekly", "monthly"} else 240
    url = (
        "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"CN_MarketData.getKLineData?symbol={sina_symbol(code)}&scale={scale}&ma=no&datalen={limit}"
    )
    text = request_text_with_curl(url)
    rows = json.loads(text)
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Sina kline empty")
    candles = []
    for row in rows:
        candles.append({
            "time": row.get("day"),
            "open": safe_float(row.get("open")),
            "close": safe_float(row.get("close")),
            "high": safe_float(row.get("high")),
            "low": safe_float(row.get("low")),
            "volume": safe_float(row.get("volume")) or 0,
            "amount": 0,
            "changePct": None,
        })
    candles = [item for item in candles if item["open"] and item["close"] and item["high"] and item["low"]]
    if not candles:
        raise RuntimeError("Sina kline no valid candles")
    return {
        "ok": True,
        "code": code,
        "name": "上证指数" if code == "000001" else code,
        "period": period,
        "candles": candles,
        "provider": "新浪K线",
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def snapshot_kline(code, period):
    quotes = fetch_quotes([code])
    if not quotes.get("ok") or not quotes.get("quotes"):
        raise RuntimeError("Snapshot quote unavailable")
    quote = quotes["quotes"][0]
    close = float(quote["price"])
    prev = float(quote.get("prevClose") or close)
    open_price = float(quote.get("open") or prev)
    high = float(quote.get("high") or max(open_price, close))
    low = float(quote.get("low") or min(open_price, close))
    amount = float(quote.get("amount") or 0)
    candles = []
    for index in range(72):
        t = index / 71
        base = open_price + (close - open_price) * t
        wave = (high - low or close * 0.01) * 0.22 * __import__("math").sin(t * 24)
        item_close = close if index == 71 else base + wave
        item_open = candles[-1]["close"] if candles else open_price
        candles.append({
            "time": time.strftime("%Y-%m-%d") if period in {"daily", "weekly", "monthly"} else f"{9 + index // 12:02d}:{(index % 12) * 5:02d}",
            "open": round(item_open, 3),
            "close": round(item_close, 3),
            "high": round(max(item_open, item_close, high if index == 71 else item_close) + 0.01, 3),
            "low": round(min(item_open, item_close, low if index == 0 else item_close) - 0.01, 3),
            "volume": amount / 72 if amount else 1,
            "amount": amount / 72 if amount else 0,
            "changePct": None,
        })
    return {
        "ok": True,
        "code": code,
        "name": quote.get("name") or code,
        "period": period,
        "candles": candles,
        "provider": f"{quote.get('provider', '快照')}兜底K线",
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def fetch_kline(code, period):
    errors = []
    for provider in (sina_kline, eastmoney_kline, snapshot_kline):
        try:
            result = provider(code, period)
            result["errors"] = errors
            return result
        except Exception as exc:
            errors.append(f"{provider.__name__}: {exc}")
    return {"ok": False, "errors": errors}


def fetch_market_mood_tencent(error_prefix=""):
    quotes = fetch_tencent(["000001", "399001", "399006", "000688"])
    index_gain = sum(float(item.get("changePct") or 0) for item in quotes) / max(len(quotes), 1)
    amount = sum(float(item.get("amount") or 0) for item in quotes if item.get("amount") is not None)
    positive = [item for item in quotes if float(item.get("changePct") or 0) > 0]
    yang = round(len(positive) / max(len(quotes), 1) * 100)
    breadth_score = yang * 0.3
    index_score = min(35, max(0, (index_gain + 1.5) * 12))
    score = round(min(100, max(0, breadth_score + index_score + 20)))
    if score >= 70:
        label = "高涨"
    elif score >= 55:
        label = "修复"
    elif score >= 40:
        label = "中性"
    elif score >= 25:
        label = "低迷"
    else:
        label = "冰点"
    return {
        "ok": True,
        "score": score,
        "label": label,
        "yangPct": yang,
        "yinPct": 100 - yang,
        "up": None,
        "down": None,
        "flat": None,
        "indexGain": round(index_gain, 2),
        "amount": round(amount, 2),
        "limitUpCount": None,
        "hotUpCount": None,
        "pressureCount": None,
        "topConcepts": [],
        "provider": "腾讯指数盘面推理",
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "errors": [error_prefix] if error_prefix else [],
    }


def eastmoney_clist(params):
    query = "&".join(f"{key}={value}" for key, value in params.items())
    last_error = None
    for host in ("https://push2.eastmoney.com", "http://push2.eastmoney.com"):
        try:
            payload = json.loads(request_text(f"{host}/api/qt/clist/get?{query}"))
            rows = payload.get("data", {}).get("diff") or []
            if rows:
                return rows
        except Exception as exc:
            last_error = exc
    raise RuntimeError(last_error or "Eastmoney clist empty")


def sina_market_rows(sort="changepercent", asc=0, pages=20, num=80):
    rows = []
    for page in range(1, pages + 1):
        url = (
            "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            f"Market_Center.getHQNodeData?page={page}&num={num}&sort={sort}&asc={asc}&node=hs_a&symbol=&_s_r_a=page"
        )
        try:
            text = request_text_with_curl(url)
            data = json.loads(text)
        except Exception:
            data = json.loads(request_text(url, referer="https://finance.sina.com.cn/"))
        if not isinstance(data, list) or not data:
            break
        rows.extend(data)
        values = [safe_float(item.get("changepercent")) for item in data]
        values = [item for item in values if item is not None]
        if not values:
            break
        if asc == 0 and min(values) < 5:
            break
        if asc == 1 and max(values) > -9.8:
            break
    return rows


def fetch_sina_strength_counts():
    up_rows = sina_market_rows(sort="changepercent", asc=0, pages=35, num=80)
    down_rows = sina_market_rows(sort="changepercent", asc=1, pages=12, num=80)
    main_up = [
        row for row in up_rows
        if re.match(r"^(600|601|603|605|000|001|002|003)\d{3}$", str(row.get("code")))
        and safe_float(row.get("changepercent")) is not None
    ]
    main_down = [
        row for row in down_rows
        if re.match(r"^(600|601|603|605|000|001|002|003)\d{3}$", str(row.get("code")))
        and safe_float(row.get("changepercent")) is not None
    ]
    return {
        "limitUpCount": len([row for row in main_up if safe_float(row.get("changepercent")) >= 9.8]),
        "hotUpCount": len([row for row in main_up if safe_float(row.get("changepercent")) >= 5]),
        "limitDownCount": len([row for row in main_down if safe_float(row.get("changepercent")) <= -9.8]),
        "provider": "新浪涨跌幅榜统计",
    }


def fetch_market_overview():
    errors = []
    def load_mood():
        return fetch_market_mood()

    def load_indices():
        return fetch_tencent(["000001", "399001", "399006", "000688"])

    def load_concepts():
        concept_rows = eastmoney_clist({
            "pn": "1",
            "pz": "8",
            "po": "1",
            "np": "1",
            "fltt": "2",
            "fid": "f3",
            "fs": "m:90+t:3",
            "fields": "f3,f12,f14,f104,f105,f128,f136",
        })
        return [
            {
                "code": str(row.get("f12")),
                "name": row.get("f14"),
                "changePct": row.get("f3"),
                "up": row.get("f104"),
                "down": row.get("f105"),
                "leader": row.get("f128"),
                "leaderChangePct": row.get("f136"),
            }
            for row in concept_rows
        ]

    def load_industries():
        industry_rows = eastmoney_clist({
            "pn": "1",
            "pz": "8",
            "po": "1",
            "np": "1",
            "fltt": "2",
            "fid": "f3",
            "fs": "m:90+t:2",
            "fields": "f3,f12,f14,f104,f105,f128,f136",
        })
        return [
            {
                "code": str(row.get("f12")),
                "name": row.get("f14"),
                "changePct": row.get("f3"),
                "up": row.get("f104"),
                "down": row.get("f105"),
                "leader": row.get("f128"),
                "leaderChangePct": row.get("f136"),
            }
            for row in industry_rows
        ]

    def load_amount_leaders():
        amount_rows = eastmoney_clist({
            "pn": "1",
            "pz": "80",
            "po": "1",
            "np": "1",
            "fltt": "2",
            "fid": "f6",
            "fs": "m:0+t:6,m:1+t:2",
            "fields": "f2,f3,f5,f6,f8,f12,f14,f15,f16,f18",
        })
        return [
            {
                "code": str(row.get("f12")),
                "name": row.get("f14"),
                "price": row.get("f2"),
                "changePct": row.get("f3"),
                "volume": row.get("f5"),
                "amount": row.get("f6"),
                "turnoverRate": row.get("f8"),
            }
            for row in amount_rows
            if re.match(r"^(600|601|603|605|000|001|002|003)\d{3}$", str(row.get("f12")))
        ][:8]

    def load_strength_counts():
        rows = eastmoney_clist({
            "pn": "1",
            "pz": "800",
            "po": "1",
            "np": "1",
            "fltt": "2",
            "fid": "f3",
            "fs": "m:0+t:6,m:1+t:2",
            "fields": "f3,f12,f14",
        })
        main_rows = [
            row for row in rows
            if re.match(r"^(600|601|603|605|000|001|002|003)\d{3}$", str(row.get("f12")))
            and safe_float(row.get("f3")) is not None
        ]
        return {
            "limitUpCount": len([row for row in main_rows if safe_float(row.get("f3")) >= 9.8]),
            "hotUpCount": len([row for row in main_rows if safe_float(row.get("f3")) >= 5]),
        }

    def load_limit_down_count():
        down_rows = eastmoney_clist({
            "pn": "1",
            "pz": "500",
            "po": "0",
            "np": "1",
            "fltt": "2",
            "fid": "f3",
            "fs": "m:0+t:6,m:1+t:2",
            "fields": "f3,f12,f14",
        })
        return len([
            row for row in down_rows
            if re.match(r"^(600|601|603|605|000|001|002|003)\d{3}$", str(row.get("f12")))
            and safe_float(row.get("f3")) is not None
            and safe_float(row.get("f3")) <= -9.8
        ])

    loaders = {
        "mood": load_mood,
        "indices": load_indices,
        "top_concepts": load_concepts,
        "top_industries": load_industries,
        "amount_leaders": load_amount_leaders,
        "strength_counts": load_strength_counts,
        "limit_down_count": load_limit_down_count,
    }
    results = {}
    try:
        results["sina_strength_counts"] = fetch_sina_strength_counts()
    except Exception as exc:
        errors.append(f"sina_strength_counts: {exc}")
    executor = ThreadPoolExecutor(max_workers=7)
    future_map = {executor.submit(loader): name for name, loader in loaders.items()}
    try:
        for future in as_completed(future_map, timeout=6):
            name = future_map[future]
            try:
                results[name] = future.result(timeout=0)
            except Exception as exc:
                future.cancel()
                errors.append(f"{name}: {exc}")
    except Exception as exc:
        errors.append(f"market loaders timeout: {exc}")
    for future, name in future_map.items():
        if future.done():
            continue
        future.cancel()
        errors.append(f"{name}: timeout")
    executor.shutdown(wait=False, cancel_futures=True)

    mood = results.get("mood") or {"ok": False, "errors": []}
    if not mood.get("ok"):
        errors.extend(mood.get("errors", []))
    indices = results.get("indices") or []
    top_concepts = results.get("top_concepts") or (mood.get("topConcepts", []) if mood.get("ok") else [])
    top_industries = results.get("top_industries") or []
    amount_leaders = results.get("amount_leaders") or []
    strength_counts = results.get("strength_counts") or {}
    sina_strength_counts_result = results.get("sina_strength_counts") or {}
    limit_down_count = results.get("limit_down_count")
    limit_up_count = mood.get("limitUpCount") if mood.get("ok") else None
    hot_up_count = mood.get("hotUpCount") if mood.get("ok") else None
    if limit_up_count is None:
        limit_up_count = strength_counts.get("limitUpCount")
    if hot_up_count is None:
        hot_up_count = strength_counts.get("hotUpCount")
    if not limit_up_count and sina_strength_counts_result.get("limitUpCount") is not None:
        limit_up_count = sina_strength_counts_result.get("limitUpCount")
    if limit_down_count is None and sina_strength_counts_result.get("limitDownCount") is not None:
        limit_down_count = sina_strength_counts_result.get("limitDownCount")
    if not hot_up_count and sina_strength_counts_result.get("hotUpCount") is not None:
        hot_up_count = sina_strength_counts_result.get("hotUpCount")
    if limit_up_count is None:
        leader_pool = (top_concepts or []) + (top_industries or [])
        limit_up_count = len([
            item for item in leader_pool
            if safe_float(item.get("leaderChangePct")) is not None and safe_float(item.get("leaderChangePct")) >= 9.8
        ])
    if hot_up_count is None:
        leader_pool = (top_concepts or []) + (top_industries or [])
        amount_hot = [
            item for item in amount_leaders
            if safe_float(item.get("changePct")) is not None and safe_float(item.get("changePct")) >= 5
        ]
        hot_up_count = len([
            item for item in leader_pool
            if safe_float(item.get("leaderChangePct")) is not None and safe_float(item.get("leaderChangePct")) >= 5
        ]) + len(amount_hot)

    return {
        "ok": True,
        "indices": indices,
        "mood": mood,
        "limitUpCount": limit_up_count,
        "limitDownCount": limit_down_count,
        "hotUpCount": hot_up_count,
        "topConcepts": top_concepts,
        "topIndustries": top_industries,
        "amountLeaders": amount_leaders,
        "provider": "腾讯行情 + 东方财富盘面 + 新浪统计",
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "errors": errors,
    }


def fetch_market_mood():
    errors = []
    try:
        indices_url = (
            "https://push2.eastmoney.com/api/qt/ulist.np/get"
            "?fltt=2&secids=1.000001,0.399001,0.399006,1.000688"
            "&fields=f2,f3,f6,f12,f14,f104,f105,f106"
        )
        indices_payload = json.loads(request_text(indices_url))
        indices = indices_payload.get("data", {}).get("diff") or []
        up = sum(int(item.get("f104") or 0) for item in indices)
        down = sum(int(item.get("f105") or 0) for item in indices)
        flat = sum(int(item.get("f106") or 0) for item in indices)
        index_gain = sum(float(item.get("f3") or 0) for item in indices) / max(len(indices), 1)
        amount = sum(float(item.get("f6") or 0) for item in indices)

        concept_url = (
            "https://push2.eastmoney.com/api/qt/clist/get"
            "?pn=1&pz=20&po=1&np=1&fltt=2&fid=f3&fs=m:90+t:3"
            "&fields=f3,f14,f104,f105,f136"
        )
        concept_payload = json.loads(request_text(concept_url))
        concepts = concept_payload.get("data", {}).get("diff") or []
        strong_concepts = [item for item in concepts if float(item.get("f3") or 0) >= 3]
        top_concepts = [
            {
                "name": item.get("f14"),
                "changePct": item.get("f3"),
                "up": item.get("f104"),
                "down": item.get("f105"),
                "leaderChangePct": item.get("f136"),
            }
            for item in concepts[:5]
        ]

        gainers_url = (
            "https://push2.eastmoney.com/api/qt/clist/get"
            "?pn=1&pz=200&po=1&np=1&fltt=2&fid=f3&fs=m:0+t:6,m:1+t:2"
            "&fields=f2,f3,f7,f8,f12,f14,f15,f16,f18"
        )
        gainers_payload = json.loads(request_text(gainers_url))
        gainers = gainers_payload.get("data", {}).get("diff") or []
        limit_up = [item for item in gainers if float(item.get("f3") or 0) >= 9.8]
        hot_up = [item for item in gainers if float(item.get("f3") or 0) >= 5]
        high_churn = [item for item in gainers if float(item.get("f8") or 0) >= 12 and float(item.get("f3") or 0) < 3]

        breadth_total = max(up + down, 1)
        yang = round((up / breadth_total) * 100)
        yin = 100 - yang
        breadth_score = min(30, max(0, yang * 0.3))
        index_score = min(20, max(0, (index_gain + 1) * 10))
        theme_score = min(25, len(strong_concepts) * 3.5)
        limit_score = min(15, len(limit_up) * 0.8 + len(hot_up) * 0.08)
        pressure_penalty = min(12, len(high_churn) * 0.6)
        score = round(min(100, max(0, breadth_score + index_score + theme_score + limit_score - pressure_penalty)))

        if score >= 70:
            label = "高涨"
        elif score >= 55:
            label = "修复"
        elif score >= 40:
            label = "中性"
        elif score >= 25:
            label = "低迷"
        else:
            label = "冰点"
        return {
            "ok": True,
            "score": score,
            "label": label,
            "yangPct": yang,
            "yinPct": yin,
            "up": up,
            "down": down,
            "flat": flat,
            "indexGain": round(index_gain, 2),
            "amount": round(amount, 2),
            "limitUpCount": len(limit_up),
            "hotUpCount": len(hot_up),
            "pressureCount": len(high_churn),
            "topConcepts": top_concepts,
            "provider": "东方财富盘面推理",
            "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
    except Exception as exc:
        errors.append(str(exc))
        try:
            return fetch_market_mood_tencent(str(exc))
        except Exception as fallback_exc:
            errors.append(f"tencent fallback: {fallback_exc}")
            return {"ok": False, "errors": errors}

def fetch_fast_news():
    urls = [
        "https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=20",
        "https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=1&pageSize=20",
    ]
    news = []
    errors = []
    for url in urls:
        try:
            payload = json.loads(request_text(url))
            rows = payload.get("data", {}).get("fastNewsList") or payload.get("data", {}).get("list") or []
            for row in rows:
                title = row.get("title") or row.get("summary") or row.get("content")
                if not title:
                    continue
                news.append({
                    "title": re.sub(r"\s+", " ", str(title)).strip(),
                    "time": row.get("showTime") or row.get("createTime") or row.get("time") or "",
                    "source": row.get("source") or "东方财富7x24",
                    "url": row.get("url") or row.get("shareUrl") or "",
                })
        except Exception as exc:
            errors.append(str(exc))
    seen = set()
    unique = []
    for item in news:
        key = item["title"][:80]
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:12], errors


def fetch_global_quotes():
    symbols = "CL=F,GC=F,SI=F,DX-Y.NYB,^GSPC,^IXIC,000001.SS,399001.SZ"
    url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={quote(symbols)}"
    rows = []
    try:
        payload = json.loads(request_text(url))
        for row in payload.get("quoteResponse", {}).get("result", []):
            rows.append({
                "symbol": row.get("symbol"),
                "name": row.get("shortName") or row.get("longName") or row.get("symbol"),
                "price": safe_float(row.get("regularMarketPrice")),
                "changePct": safe_float(row.get("regularMarketChangePercent")),
                "source": "Yahoo Finance",
            })
    except Exception:
        rows = []
    return rows


def classify_news(news):
    domestic_keys = ("政策", "国务院", "央行", "证监会", "交易所", "发改委", "财政部", "商务部", "工信部", "国内", "A股", "人民币", "地产", "半导体", "人工智能")
    global_keys = ("美国", "伊朗", "以色列", "中东", "战争", "美联储", "美元", "原油", "黄金", "油价", "金价", "关税", "美股", "纳斯达克")
    domestic = [item for item in news if any(key in item["title"] for key in domestic_keys)]
    global_news = [item for item in news if any(key in item["title"] for key in global_keys)]
    return domestic[:6], global_news[:6]


def build_after_close_analysis():
    errors = []
    try:
        market = fetch_market_overview()
    except Exception as exc:
        errors.append(f"market: {exc}")
        market = {"ok": False, "indices": [], "topConcepts": [], "topIndustries": [], "amountLeaders": []}
    try:
        news, news_errors = fetch_fast_news()
        errors.extend([f"news: {item}" for item in news_errors[:2]])
    except Exception as exc:
        errors.append(f"news: {exc}")
        news = []
    global_quotes = fetch_global_quotes()
    domestic, global_news = classify_news(news)

    indices = market.get("indices") or []
    avg_index = sum(float(item.get("changePct") or 0) for item in indices) / max(len(indices), 1)
    limit_up = market.get("limitUpCount") or 0
    limit_down = market.get("limitDownCount") or 0
    hot_up = market.get("hotUpCount") or 0
    concepts = market.get("topConcepts") or []
    industries = market.get("topIndustries") or []
    if avg_index >= 1 and limit_up >= 50:
        conclusion = "偏多"
    elif avg_index >= 0.2 and hot_up >= 60:
        conclusion = "中性偏多"
    elif avg_index <= -0.8 or limit_down >= 30:
        conclusion = "偏弱"
    else:
        conclusion = "中性"

    focus = []
    if concepts:
        focus.append(f"概念主线：{concepts[0].get('name')} {safe_float(concepts[0].get('changePct')) or 0:.2f}%")
    if industries:
        focus.append(f"行业主线：{industries[0].get('name')} {safe_float(industries[0].get('changePct')) or 0:.2f}%")
    if global_quotes:
        quote_bits = []
        for item in global_quotes[:6]:
            pct_value = item.get("changePct")
            if pct_value is None:
                continue
            quote_bits.append(f"{item.get('name')} {pct_value:.2f}%")
        if quote_bits:
            focus.append("海外/商品：" + "；".join(quote_bits[:4]))

    return {
        "ok": True,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "conclusion": conclusion,
        "summary": f"指数均值 {avg_index:.2f}%，涨停 {limit_up}，跌停 {limit_down}，强势股 {hot_up}。{'；'.join(focus) if focus else '等待更多消息确认。'}",
        "market": market,
        "domesticNews": domestic or news[:6],
        "globalNews": global_news or news[6:12],
        "globalQuotes": global_quotes,
        "risks": [
            "关注国内政策、监管表态和行业扶持是否延续。",
            "关注美联储预期、美元指数、国际油价和金价对风险偏好的影响。",
            "若地缘冲突升级，能源、黄金、防务方向可能受刺激，成长股估值承压。",
        ],
        "nextPlan": [
            "明日开盘先观察集合竞价强弱，指数不弱且主线延续时再考虑进攻。",
            "优先保留强板块中未破分时均价、成交承接稳定的持仓。",
            "若热点退潮或跌停数扩大，降低开新仓优先级。",
        ],
        "sources": ["东方财富7x24", "腾讯行情", "东方财富盘面", "Yahoo Finance"],
        "errors": errors,
    }


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def send_json(self, result, status=200):
        body = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/account":
            account = load_account_from_disk()
            self.send_json({"ok": True, "account": account, "storage": storage_status()})
            return
        if parsed.path == "/api/storage":
            self.send_json(storage_status())
            return
        if parsed.path == "/api/export-portable":
            try:
                zip_path = build_portable_zip()
                filename = os.path.basename(zip_path)
                with open(zip_path, "rb") as file:
                    body = file.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=500)
            return
        if parsed.path == "/api/download-db":
            try:
                ensure_storage()
                if not os.path.exists(SQLITE_PATH):
                    raise FileNotFoundError("database not found")
                with open(SQLITE_PATH, "rb") as file:
                    body = file.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", 'attachment; filename="linlin-trading.sqlite"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=404)
            return
        if parsed.path == "/api/quotes":
            params = parse_qs(parsed.query)
            codes = [code for code in ",".join(params.get("codes", [])).split(",") if re.match(r"^\d{6}$", code)]
            result = fetch_quotes(codes) if codes else {"ok": False, "quotes": [], "errors": ["missing codes"]}
            self.send_json(result)
            return
        if parsed.path == "/api/mood":
            result = fetch_market_mood()
            self.send_json(result)
            return
        if parsed.path == "/api/market":
            try:
                result = fetch_market_overview()
            except Exception as exc:
                result = {
                    "ok": True,
                    "indices": [],
                    "mood": {"ok": False, "errors": [str(exc)]},
                    "limitUpCount": None,
                    "limitDownCount": None,
                    "hotUpCount": None,
                    "topConcepts": [],
                    "topIndustries": [],
                    "amountLeaders": [],
                    "provider": "盘面接口兜底",
                    "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "errors": [str(exc)],
                }
                try:
                    result.update(fetch_sina_strength_counts())
                except Exception as fallback_exc:
                    result["errors"].append(f"sina fallback: {fallback_exc}")
            self.send_json(result)
            return
        if parsed.path == "/api/after-close":
            result = build_after_close_analysis()
            self.send_json(result)
            return
        if parsed.path == "/api/kline":
            params = parse_qs(parsed.query)
            code = (params.get("code") or ["000001"])[0]
            period = (params.get("period") or ["daily"])[0]
            result = fetch_kline(code, period)
            self.send_json(result)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/account":
            try:
                payload = read_request_json(self)
                account = payload.get("account") or payload
                if not isinstance(account, dict) or not isinstance(account.get("history"), list):
                    raise ValueError("invalid account payload")
                envelope = save_account_to_disk(account, create_backup=bool(payload.get("backup", False)))
                self.send_json({"ok": True, "storage": storage_status(), "checksum": envelope["checksum"]})
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        if parsed.path == "/api/backup":
            try:
                payload = read_request_json(self)
                account = payload.get("account") or load_account_from_disk()
                if not isinstance(account, dict):
                    raise ValueError("missing account payload")
                envelope = save_account_to_disk(account, create_backup=True)
                self.send_json({"ok": True, "storage": storage_status(), "checksum": envelope["checksum"]})
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        if parsed.path == "/api/import-backup":
            try:
                payload = read_request_json(self)
                account = payload.get("account") or payload
                if not isinstance(account, dict) or not isinstance(account.get("history"), list):
                    raise ValueError("invalid backup payload")
                envelope = save_account_to_disk(account, create_backup=True)
                self.send_json({"ok": True, "account": account, "storage": storage_status(), "checksum": envelope["checksum"]})
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        if parsed.path == "/api/restore-latest":
            try:
                ensure_storage()
                backups = [
                    os.path.join(BACKUP_DIR, name)
                    for name in os.listdir(BACKUP_DIR)
                    if name.startswith("linlin-") and name.endswith(".sqlite")
                ]
                backups.sort(key=lambda path: os.path.getmtime(path), reverse=True)
                if not backups:
                    raise FileNotFoundError("没有可恢复的数据库备份")
                shutil.copy2(backups[0], SQLITE_PATH)
                account = load_account_from_disk()
                self.send_json({"ok": True, "account": account, "restoredFrom": os.path.basename(backups[0]), "storage": storage_status()})
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=404)
            return
        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/account":
            ensure_storage()
            try:
                if os.path.exists(SQLITE_PATH):
                    os.remove(SQLITE_PATH)
            except OSError:
                pass
            self.send_json({"ok": True, "storage": storage_status()})
            return
        self.send_error(404)


if __name__ == "__main__":
    ensure_storage()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving 淋淋的实盘 on http://{HOST}:{PORT}/")
    server.serve_forever()
