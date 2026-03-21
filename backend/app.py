import json
import os
import time
from datetime import datetime
from typing import Any

import requests
import urllib3
from flask import Flask, jsonify, request
from flask_cors import CORS


MALLCOO_URL = "https://m.mallcoo.cn/api/park/ParkFee/GetParkFeeInit"
CACHE_TTL_SECONDS = int(os.getenv("PARKING_CACHE_TTL_SECONDS", "300"))
DEFAULT_TIMEOUT_SECONDS = int(os.getenv("PARKING_REQUEST_TIMEOUT_SECONDS", "15"))

app = Flask(__name__)
CORS(app)

_cache: dict[str, dict[str, Any]] = {}


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_owner_map() -> dict[str, str]:
    raw_json = os.getenv("PARKING_OWNER_MAP_JSON", "").strip()
    if not raw_json:
        return {}
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(key).strip().upper(): str(value) for key, value in parsed.items()}


OWNER_MAP = load_owner_map()

if env_bool("PARKING_INSECURE_SSL", False):
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def ok(data: Any = None, message: str = "ok", status: int = 200):
    return jsonify({"success": True, "message": message, "data": data}), status


def fail(message: str, status: int = 400, data: Any = None):
    return jsonify({"success": False, "message": message, "data": data}), status


def normalize_plate(value: str = "") -> str:
    return str(value).strip().upper()


def get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def cache_key(plate: str) -> str:
    today = datetime.now().strftime("%Y-%m-%d")
    return f"{today}:{plate}"


def get_cached_result(plate: str):
    key = cache_key(plate)
    entry = _cache.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return entry["data"]


def set_cached_result(plate: str, data: dict[str, Any]):
    _cache[cache_key(plate)] = {"ts": time.time(), "data": data}


def get_owner(plate: str) -> str:
    return OWNER_MAP.get(plate, "")


def query_upstream_raw(plate: str) -> dict[str, Any]:
    token = get_required_env("PARKING_TOKEN")
    mall_id = int(os.getenv("PARKING_MALL_ID", "11192"))
    park_id = int(os.getenv("PARKING_PARK_ID", "625"))

    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": token,
        "User-Agent": os.getenv(
            "PARKING_USER_AGENT",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        ),
    }
    payload = {"ParkID": park_id, "PlateNo": plate, "MallID": mall_id}
    response = requests.post(
        MALLCOO_URL,
        json=payload,
        headers=headers,
        timeout=DEFAULT_TIMEOUT_SECONDS,
        verify=not env_bool("PARKING_INSECURE_SSL", False),
    )
    response.raise_for_status()
    return response.json()


def normalize_query_result(plate: str, result: dict[str, Any]) -> dict[str, Any]:
    if result.get("m") == 1 and result.get("d"):
        data = result["d"]
        entry_str = data.get("EntryTime", "") or ""
        mins = data.get("ParkingMinutes") or 0
        need_pay = (data.get("NeedPayAmount") or 0) / 100

        now = datetime.now()
        today_mins = mins
        if entry_str:
            try:
                entry_time = datetime.strptime(entry_str[:16], "%Y-%m-%d %H:%M")
                today_start = datetime(now.year, now.month, now.day)
                effective_start = max(entry_time, today_start)
                today_mins = max(0, (now - effective_start).total_seconds() / 60)
            except ValueError:
                pass

        return {
            "plate": plate,
            "owner": get_owner(plate),
            "entry": entry_str[:16] if entry_str else "",
            "total_hours": mins / 60,
            "today_hours": today_mins / 60,
            "remaining_8h": max(0, 8 - today_mins / 60),
            "need_pay": need_pay,
            "status": "success",
        }

    if result.get("m") in {0, 300}:
        return {
            "plate": plate,
            "owner": get_owner(plate),
            "entry": "",
            "total_hours": 0,
            "today_hours": 0,
            "remaining_8h": 8,
            "need_pay": 0,
            "status": "not_found",
            "msg": result.get("s") or result.get("e") or "未在场",
        }

    return {
        "plate": plate,
        "owner": get_owner(plate),
        "entry": "",
        "total_hours": 0,
        "today_hours": 0,
        "remaining_8h": 8,
        "need_pay": 0,
        "status": "error",
        "msg": result.get("s") or result.get("e") or "查询失败",
    }


def query_plate(plate: str) -> dict[str, Any]:
    cached = get_cached_result(plate)
    if cached is not None:
        return cached

    normalized = normalize_query_result(plate, query_upstream_raw(plate))
    if normalized["status"] == "success":
        set_cached_result(plate, normalized)
    return normalized


@app.get("/api/health")
def health():
    configured = bool(os.getenv("PARKING_TOKEN", "").strip())
    return ok(
        {
            "status": "ok",
            "configured": configured,
            "mall_id": os.getenv("PARKING_MALL_ID", "11192"),
            "park_id": os.getenv("PARKING_PARK_ID", "625"),
        }
    )


@app.post("/api/query")
def query_single():
    data = request.get_json(silent=True) or {}
    plate = normalize_plate(data.get("plate", ""))
    if not plate:
        return fail("请提供车牌号", 400)

    try:
        return ok(query_plate(plate))
    except requests.RequestException as exc:
        return fail(f"上游请求失败: {exc}", 502)
    except RuntimeError as exc:
        return fail(str(exc), 500)
    except Exception as exc:
        return fail(f"查询异常: {exc}", 500)


@app.post("/api/batch-query")
def batch_query():
    data = request.get_json(silent=True) or {}
    plates = data.get("plates", [])
    if not isinstance(plates, list) or not plates:
        return fail("请提供车牌号列表", 400)

    normalized_plates = [normalize_plate(item) for item in plates if normalize_plate(item)]
    if not normalized_plates:
        return fail("请提供有效车牌号列表", 400)

    results = []
    for plate in normalized_plates:
        try:
            results.append(query_plate(plate))
        except requests.RequestException as exc:
            results.append({"plate": plate, "status": "error", "msg": f"上游请求失败: {exc}"})
        except RuntimeError as exc:
            results.append({"plate": plate, "status": "error", "msg": str(exc)})
        except Exception as exc:
            results.append({"plate": plate, "status": "error", "msg": f"查询异常: {exc}"})

    return ok(results)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port)
