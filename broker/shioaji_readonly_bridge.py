"""Local, read-only Shioaji market-data bridge.

This process intentionally exposes only health and normalized quote snapshots.
It contains no order, cancel, position, balance, or certificate operations.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import signal
import subprocess
import sys
import threading
import traceback
import ctypes
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import shioaji as sj
from live_event_ledger import LiveEventLedger
from txo_live_chain import (
    contract_metadata,
    load_activation_config,
    load_governed_calendar,
    resolve_session_trade_date,
    select_governed_universe,
    select_nearest_expiry_contracts,
)


ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_PATH = ROOT / ".shioaji.credentials.json"
CREDENTIAL_READER = ROOT / "scripts" / "read-shioaji-credentials.ps1"
HOST = "127.0.0.1"
PORT = 8790
LATEST: dict[str, dict[str, Any]] = {}
LEADERSHIP_CACHE: dict[str, Any] = {
    "indexContribution": {},
    "industryContribution": None,
    "simulatedMatching": {"indexContribution": {}, "industryContribution": None},
}
FUTURES_METADATA: dict[str, dict[str, str]] = {}
OPTIONS_METADATA: dict[str, dict[str, Any]] = {}
LOCK = threading.Lock()
EVENT_LEDGER = LiveEventLedger(ROOT / "data" / "live-events")
SERVER: ThreadingHTTPServer | None = None
SINGLE_INSTANCE_MUTEX_NAME = "Local\\TaiwanStockShioajiReadOnlyBridge"
EVENT_QUEUE_CAPACITY = 50_000
TAIPEI_TIMEZONE = timezone(timedelta(hours=8))
INDUSTRY_POINTS_TOLERANCE = 0.1
LEADERSHIP_COLLECTION_ENABLED = (
    os.getenv("IX0001_LEADERSHIP_COLLECTION_ENABLED", "").strip().lower() == "true"
)
EVENT_QUEUE: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue(
    maxsize=EVENT_QUEUE_CAPACITY
)
QUEUE_STATE: dict[str, Any] = {
    "queued": 0,
    "written": 0,
    "dropped": 0,
    "callbackErrors": 0,
    "lastCallbackError": None,
    "writerErrors": 0,
    "lastWriterError": None,
    "sessionDown": False,
    "subscriptionGeneration": 0,
    "writerThreadAlive": False,
}
BRIDGE_STARTED_AT: str | None = None
LAST_HEALTHY_AT: str | None = None
EXPECTED_STOP_REQUESTED = False
TXO_COLLECTION_STATE: dict[str, Any] = {
    "enabled": False,
    "collectorState": "STOPPED_EXPECTED",
    "universeContractVersion": "txo-live-chain-forward-v1",
    "subscriptionCount": 0,
    "selectedContractCount": 0,
    "expectedSubscriptionCount": 0,
    "restoredSubscriptionCount": 0,
    "lastQuoteAt": None,
    "latestEventTime": None,
    "latestReceivedAt": None,
    "writerState": "UNKNOWN",
    "queueDepth": 0,
    "dropped": 0,
    "callbackErrors": 0,
    "writerErrors": 0,
    "diskHealth": "UNKNOWN",
    "sourceRoot": "TXO",
    "expiryClass": "MONTHLY",
    "nativeSequenceAvailability": "UNAVAILABLE",
    "packetLossCertainty": "UNKNOWN_NO_NATIVE_SEQUENCE",
    "productionActivationApproved": False,
}
REQUIRED_SUBSCRIPTIONS: dict[str, dict[str, Any]] = {
    "TX": {"product": "TX", "subscriptionAlias": "TXFR1", "quoteTypes": ["Tick", "BidAsk"], "state": "PENDING", "actualContract": None, "lastObservedAt": None},
    "MTX": {"product": "MTX", "subscriptionAlias": "MXFR1", "quoteTypes": ["Tick", "BidAsk"], "state": "PENDING", "actualContract": None, "lastObservedAt": None},
    "TMF": {"product": "TMF", "subscriptionAlias": "TMFR1", "quoteTypes": ["Tick", "BidAsk"], "state": "PENDING", "actualContract": None, "lastObservedAt": None},
    "2330": {"product": "2330", "subscriptionAlias": "2330", "quoteTypes": ["Tick"], "state": "PENDING", "actualContract": "2330", "lastObservedAt": None},
    "IX0001": {"product": "IX0001", "subscriptionAlias": "IX0001", "quoteTypes": ["Quote"], "state": "PENDING", "actualContract": "IX0001", "lastObservedAt": None},
}
LEADERSHIP_REQUIRED_SUBSCRIPTIONS: dict[str, dict[str, Any]] = {
    "IX0001_INDEX_ABS10": {"product": "IX0001_INDEX_ABS10", "subscriptionAlias": "IX0001", "quoteTypes": ["IndexContribution:abs10"], "state": "PENDING", "actualContract": "IX0001", "lastObservedAt": None},
    "IX0001_INDEX_POSITIVE25": {"product": "IX0001_INDEX_POSITIVE25", "subscriptionAlias": "IX0001", "quoteTypes": ["IndexContribution:positive25"], "state": "PENDING", "actualContract": "IX0001", "lastObservedAt": None},
    "IX0001_INDEX_NEGATIVE25": {"product": "IX0001_INDEX_NEGATIVE25", "subscriptionAlias": "IX0001", "quoteTypes": ["IndexContribution:negative25"], "state": "PENDING", "actualContract": "IX0001", "lastObservedAt": None},
    "IX0001_INDUSTRY": {"product": "IX0001_INDUSTRY", "subscriptionAlias": "IX0001", "quoteTypes": ["IndustryContribution"], "state": "PENDING", "actualContract": "IX0001", "lastObservedAt": None},
}
if LEADERSHIP_COLLECTION_ENABLED:
    REQUIRED_SUBSCRIPTIONS.update(LEADERSHIP_REQUIRED_SUBSCRIPTIONS)

LEADERSHIP_HEALTH: dict[str, dict[str, Any]] = {
    "ix0001IndexContribution": {
        "sourceAvailability": "SOURCE_AVAILABLE", "subscriptionState": "PENDING",
        "tradeDate": None, "session": "DAY", "availableAt": None,
        "freshnessState": "UNAVAILABLE", "quality": "UNAVAILABLE",
        "simtradeState": "NO_EVENT", "reconnectState": "PENDING",
        "restorationState": "PENDING", "promotionState": "NOT_PROMOTED",
    },
    "ix0001IndustryContribution": {
        "sourceAvailability": "SOURCE_AVAILABLE", "subscriptionState": "PENDING",
        "tradeDate": None, "session": "DAY", "availableAt": None,
        "freshnessState": "UNAVAILABLE", "quality": "UNAVAILABLE",
        "simtradeState": "NO_EVENT", "reconnectState": "PENDING",
        "restorationState": "PENDING", "promotionState": "NOT_PROMOTED",
    },
}


def acquire_single_instance() -> Any:
    if os.name != "nt":
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, False, SINGLE_INSTANCE_MUTEX_NAME)
    if not handle:
        raise OSError(ctypes.get_last_error(), "CreateMutexW failed")
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle(handle)
        raise RuntimeError("shioaji_readonly_bridge_already_running")
    return handle


def release_single_instance(handle: Any) -> None:
    if os.name == "nt" and handle:
        ctypes.WinDLL("kernel32").CloseHandle(handle)


def enqueue(kind: str, payload: dict[str, Any]) -> None:
    try:
        EVENT_QUEUE.put_nowait((kind, payload))
        with LOCK:
            QUEUE_STATE["queued"] += 1
    except queue.Full:
        with LOCK:
            QUEUE_STATE["dropped"] += 1


def record_lifecycle(kind: str, **details: Any) -> None:
    enqueue(kind, {
        "code": "bridge",
        "datetime": datetime.now().astimezone().isoformat(),
        **details,
    })


def load_credentials(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(
            "missing DPAPI credentials; run 17_MIGRATE_SHIOAJI_SECURITY.bat "
            "or 14_SETUP_SHIOAJI_READONLY.bat"
        )
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(CREDENTIAL_READER),
            "-Path",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        creationflags=creation_flags,
    )
    credentials = json.loads(result.stdout)
    if not credentials.get("apiKey") or not credentials.get("secretKey"):
        raise RuntimeError("DPAPI credentials are incomplete")
    return credentials


def safe_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Enum):
        return safe_value(value.value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (list, tuple)):
        return [safe_value(item) for item in value]
    if isinstance(value, set):
        return [safe_value(item) for item in sorted(value, key=str)]
    if isinstance(value, Mapping):
        return {str(key): safe_value(item) for key, item in value.items()}
    if hasattr(value, "value"):
        return safe_value(value.value)
    if hasattr(value, "to_dict"):
        return safe_value(value.to_dict())
    if hasattr(value, "__dict__"):
        return safe_value(vars(value))
    return str(value)


def canonical_json(value: Any) -> str:
    return json.dumps(
        safe_value(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def provider_event_time(payload: Mapping[str, Any]) -> str | None:
    raw_date = str(payload.get("date") or "").strip()
    raw_time = str(payload.get("time") or "").strip()
    if not raw_date or not raw_time:
        return None
    try:
        parsed = datetime.strptime(
            f"{raw_date} {raw_time}", "%Y/%m/%d %H:%M:%S.%f"
        ).replace(tzinfo=TAIPEI_TIMEZONE)
    except ValueError:
        try:
            parsed = datetime.strptime(
                f"{raw_date} {raw_time}", "%Y/%m/%d %H:%M:%S"
            ).replace(tzinfo=TAIPEI_TIMEZONE)
        except ValueError:
            return None
    return parsed.isoformat()


def trade_date_value(payload: Mapping[str, Any]) -> str | None:
    raw = str(payload.get("date") or "").strip()
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y/%m/%d").date().isoformat()
    except ValueError:
        return None


def finite_number(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float, Decimal)):
        parsed = float(value)
        if parsed == parsed and parsed not in (float("inf"), float("-inf")):
            return int(parsed) if parsed.is_integer() and isinstance(value, int) else parsed
    return None


def enriched_provider_dict(data: Any) -> Any:
    if hasattr(data, "to_dict"):
        try:
            return data.to_dict()
        except TypeError:
            return data.to_dict(raw=True)
    return vars(data)


def normalize_index_contribution(data: Any, received_at: str | None = None) -> dict[str, Any]:
    provider_raw = enriched_provider_dict(data)
    provider = safe_value(provider_raw)
    if not isinstance(provider, dict):
        raise TypeError("index contribution payload must be a mapping")
    received = received_at or datetime.now().astimezone().isoformat()
    ranking = str(provider.get("ranking") or "").lower()
    entries = []
    quality_reasons = []
    for entry in provider.get("entries") or []:
        if not isinstance(entry, Mapping):
            quality_reasons.append("ENTRY_NOT_MAPPING")
            continue
        row = safe_value(entry)
        entries.append({
            "code": str(row.get("code") or ""),
            "price": finite_number(row.get("price")),
            "reference": finite_number(row.get("reference")),
            "priceChange": finite_number(row.get("price_chg")),
            "pctChange": finite_number(row.get("pct_chg")),
            "points": finite_number(row.get("points")),
        })
    if str(provider.get("code") or "") != "IX0001":
        quality_reasons.append("INDEX_CODE_NOT_IX0001")
    if ranking not in {"abs10", "positive25", "negative25"}:
        quality_reasons.append("RANKING_NOT_OWNER_APPROVED")
    if not entries:
        quality_reasons.append("ENTRIES_EMPTY")
    if any(not row["code"] or row["points"] is None for row in entries):
        quality_reasons.append("ENTRY_REQUIRED_FIELD_MISSING")
    simtrade = provider.get("simtrade") is True
    return {
        "recordType": "IX0001_INDEX_CONTRIBUTION_RAW",
        "tradeDate": trade_date_value(provider),
        "session": "DAY",
        "indexCode": str(provider.get("code") or ""),
        "ranking": ranking,
        "eventTime": provider_event_time(provider),
        "receivedAt": received,
        "availableAt": received,
        "simtrade": simtrade,
        "simtradeState": "SIMULATED_MATCHING" if simtrade else "LIVE_MATCHING",
        "sourceVersion": str(getattr(sj, "__version__", "1.7.2")),
        "qualityStatus": "PASS" if not quality_reasons else "QUALITY_INSUFFICIENT",
        "qualityReasons": quality_reasons,
        "rawPayloadHash": hashlib.sha256(canonical_json(provider).encode("utf-8")).hexdigest(),
        "entries": entries,
        "providerPayload": provider,
        "formalWeight": 0,
        "researchOnly": True,
        "executionAuthorized": False,
        "orderRoutesEnabled": False,
        "promotionState": "NOT_PROMOTED",
    }


def normalize_industry_contribution(data: Any, received_at: str | None = None) -> dict[str, Any]:
    provider_raw = enriched_provider_dict(data)
    provider = safe_value(provider_raw)
    if not isinstance(provider, dict):
        raise TypeError("industry contribution payload must be a mapping")
    received = received_at or datetime.now().astimezone().isoformat()
    entries = []
    quality_reasons = []
    for entry in provider.get("entries") or []:
        if not isinstance(entry, Mapping):
            quality_reasons.append("ENTRY_NOT_MAPPING")
            continue
        row = safe_value(entry)
        entries.append({
            "category": str(row.get("category") or ""),
            "points": finite_number(row.get("points")),
        })
    index_close = finite_number(provider.get("index_close"))
    index_price_change = finite_number(provider.get("index_price_chg"))
    points = [row["points"] for row in entries if row["points"] is not None]
    points_sum = sum(points) if len(points) == len(entries) else None
    invariant_delta = (
        abs(float(points_sum) - float(index_price_change))
        if points_sum is not None and index_price_change is not None else None
    )
    if str(provider.get("code") or "") != "IX0001":
        quality_reasons.append("INDEX_CODE_NOT_IX0001")
    if not entries:
        quality_reasons.append("ENTRIES_EMPTY")
    if any(not row["category"] or row["points"] is None for row in entries):
        quality_reasons.append("ENTRY_REQUIRED_FIELD_MISSING")
    if invariant_delta is None:
        quality_reasons.append("INDUSTRY_SUM_INVARIANT_UNAVAILABLE")
    elif invariant_delta > INDUSTRY_POINTS_TOLERANCE:
        quality_reasons.append("INDUSTRY_SUM_INVARIANT_FAILED")
    simtrade = provider.get("simtrade") is True
    return {
        "recordType": "IX0001_INDUSTRY_CONTRIBUTION_RAW",
        "tradeDate": trade_date_value(provider),
        "session": "DAY",
        "indexCode": str(provider.get("code") or ""),
        "eventTime": provider_event_time(provider),
        "receivedAt": received,
        "availableAt": received,
        "simtrade": simtrade,
        "simtradeState": "SIMULATED_MATCHING" if simtrade else "LIVE_MATCHING",
        "sourceVersion": str(getattr(sj, "__version__", "1.7.2")),
        "qualityStatus": "PASS" if not quality_reasons else "QUALITY_INSUFFICIENT",
        "qualityReasons": quality_reasons,
        "rawPayloadHash": hashlib.sha256(canonical_json(provider).encode("utf-8")).hexdigest(),
        "indexClose": index_close,
        "indexPriceChange": index_price_change,
        "industryPointsSum": points_sum,
        "industryInvariantDelta": invariant_delta,
        "industryInvariantTolerance": INDUSTRY_POINTS_TOLERANCE,
        "entries": entries,
        "providerPayload": provider,
        "formalWeight": 0,
        "researchOnly": True,
        "executionAuthorized": False,
        "orderRoutesEnabled": False,
        "promotionState": "NOT_PROMOTED",
    }


def record_index_contribution(data: Any) -> None:
    try:
        enqueue("ix0001_index_contribution", normalize_index_contribution(data))
    except Exception as error:
        record_callback_error(error)


def record_industry_contribution(data: Any) -> None:
    try:
        enqueue("ix0001_industry_contribution", normalize_industry_contribution(data))
    except Exception as error:
        record_callback_error(error)


def record_callback_error(error: Exception) -> None:
    frame = traceback.extract_tb(error.__traceback__)[-1]
    with LOCK:
        QUEUE_STATE["callbackErrors"] += 1
        QUEUE_STATE["lastCallbackError"] = (
            f"{type(error).__name__} at {Path(frame.filename).name}:"
            f"{frame.lineno} {frame.name}: {str(error)[:180]}"
        )


def record(kind: str, data: Any) -> None:
    try:
        payload = data.to_dict(raw=True) if hasattr(data, "to_dict") else vars(data)
        normalized = safe_value(payload)
        if not isinstance(normalized, dict):
            raise TypeError(
                f"normalized callback payload must be a mapping, got {type(normalized).__name__}"
            )
        normalized["_kind"] = kind
        normalized["_received_at"] = datetime.now().astimezone().isoformat()
        code = str(normalized.get("code") or normalized.get("Code") or "")
        option_metadata = OPTIONS_METADATA.get(code)
        if option_metadata:
            kind = "options_tick" if kind == "futures_tick" else "options_bidask"
            normalized["_kind"] = kind
            normalized["_product_family"] = "TXO"
            normalized["_source_root"] = option_metadata["sourceRoot"]
            normalized["_expiry_class"] = option_metadata["expiryClass"]
            normalized["_expiry"] = option_metadata["expiry"]
            normalized["_strike"] = option_metadata["strike"]
            normalized["_call_put"] = option_metadata["callPut"]
            normalized["_collection_run_id"] = BRIDGE_STARTED_AT
            event_raw = normalized.get("datetime") or normalized.get("timestamp")
            if event_raw:
                event_time = datetime.fromisoformat(str(event_raw).replace("Z", "+00:00"))
                session, trade_date = resolve_session_trade_date(
                    event_time, option_metadata["calendar"]
                )
                normalized["_session"] = session
                normalized["_trade_date"] = trade_date
            with LOCK:
                TXO_COLLECTION_STATE["lastQuoteAt"] = normalized["_received_at"]
                TXO_COLLECTION_STATE["latestReceivedAt"] = normalized["_received_at"]
                TXO_COLLECTION_STATE["latestEventTime"] = str(event_raw) if event_raw else None
        futures_metadata = FUTURES_METADATA.get(code)
        if futures_metadata:
            normalized["_product_family"] = futures_metadata["productFamily"]
            normalized["_subscription_alias"] = futures_metadata["subscriptionAlias"]
            normalized["_target_code"] = futures_metadata["targetCode"]
        product = futures_metadata["productFamily"] if futures_metadata else code
        with LOCK:
            subscription = REQUIRED_SUBSCRIPTIONS.get(product)
            if subscription is not None:
                subscription["lastObservedAt"] = normalized["_received_at"]
        enqueue(kind, normalized)
    except Exception as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        with LOCK:
            QUEUE_STATE["callbackErrors"] += 1
            QUEUE_STATE["lastCallbackError"] = (
                f"{type(error).__name__} at {Path(frame.filename).name}:"
                f"{frame.lineno} {frame.name}: {str(error)[:180]}"
            )


def event_writer() -> None:
    while True:
        item = EVENT_QUEUE.get()
        try:
            if item is None:
                return
            kind, normalized = item
            code = str(normalized.get("code") or normalized.get("Code") or kind)
            stored = EVENT_LEDGER.append(kind, normalized)
            with LOCK:
                latest_key = code
                if kind == "ix0001_index_contribution":
                    latest_key = f"IX0001:index_contribution:{normalized.get('ranking') or 'unknown'}"
                elif kind == "ix0001_industry_contribution":
                    latest_key = "IX0001:industry_contribution"
                LATEST[latest_key] = stored
                if kind == "ix0001_index_contribution":
                    simulated = normalized.get("simtrade") is True
                    bucket = (
                        LEADERSHIP_CACHE["simulatedMatching"]["indexContribution"]
                        if simulated
                        else LEADERSHIP_CACHE["indexContribution"]
                    )
                    bucket[str(normalized.get("ranking") or "unknown")] = normalized
                    health = LEADERSHIP_HEALTH["ix0001IndexContribution"]
                    if simulated:
                        health["simtradeState"] = "SIMULATED_MATCHING_PRESENT"
                    else:
                        health.update({
                            "tradeDate": normalized.get("tradeDate"),
                            "availableAt": normalized.get("availableAt"),
                            "freshnessState": "LIVE",
                            "quality": normalized.get("qualityStatus"),
                            "simtradeState": "LIVE_MATCHING",
                        })
                    subscription_key = {
                        "abs10": "IX0001_INDEX_ABS10",
                        "positive25": "IX0001_INDEX_POSITIVE25",
                        "negative25": "IX0001_INDEX_NEGATIVE25",
                    }.get(str(normalized.get("ranking") or ""))
                    if subscription_key and not simulated:
                        LEADERSHIP_REQUIRED_SUBSCRIPTIONS[subscription_key]["lastObservedAt"] = normalized.get("availableAt")
                elif kind == "ix0001_industry_contribution":
                    simulated = normalized.get("simtrade") is True
                    if simulated:
                        LEADERSHIP_CACHE["simulatedMatching"]["industryContribution"] = normalized
                    else:
                        LEADERSHIP_CACHE["industryContribution"] = normalized
                    health = LEADERSHIP_HEALTH["ix0001IndustryContribution"]
                    if simulated:
                        health["simtradeState"] = "SIMULATED_MATCHING_PRESENT"
                    else:
                        health.update({
                            "tradeDate": normalized.get("tradeDate"),
                            "availableAt": normalized.get("availableAt"),
                            "freshnessState": "LIVE",
                            "quality": normalized.get("qualityStatus"),
                            "simtradeState": "LIVE_MATCHING",
                        })
                        LEADERSHIP_REQUIRED_SUBSCRIPTIONS["IX0001_INDUSTRY"]["lastObservedAt"] = normalized.get("availableAt")
                QUEUE_STATE["written"] += 1
        except Exception as error:  # keep health endpoint alive and fail visibly
            frame = traceback.extract_tb(error.__traceback__)[-1]
            with LOCK:
                QUEUE_STATE["writerErrors"] += 1
                QUEUE_STATE["lastWriterError"] = (
                    f"{type(error).__name__} at {Path(frame.filename).name}:"
                    f"{frame.lineno} {frame.name}: {str(error)[:180]}"
                )
        finally:
            EVENT_QUEUE.task_done()


def taipei_day_session(now: datetime | None = None) -> bool:
    current = (now or datetime.now(TAIPEI_TIMEZONE)).astimezone(TAIPEI_TIMEZONE)
    return current.weekday() < 5 and time(9, 0) <= current.time() <= time(13, 35)


def leadership_payload(now: datetime | None = None) -> dict[str, Any]:
    current = (now or datetime.now(TAIPEI_TIMEZONE)).astimezone(TAIPEI_TIMEZONE)
    with LOCK:
        index_rows = dict(LEADERSHIP_CACHE["indexContribution"])
        industry = LEADERSHIP_CACHE["industryContribution"]
        simulated = {
            "indexContribution": dict(LEADERSHIP_CACHE["simulatedMatching"]["indexContribution"]),
            "industryContribution": LEADERSHIP_CACHE["simulatedMatching"]["industryContribution"],
        }
    available_times = [
        row.get("availableAt") for row in [*index_rows.values(), industry] if row
    ]
    last_available_at = max((value for value in available_times if value), default=None)
    source_trade_date = max(
        (row.get("tradeDate") for row in [*index_rows.values(), industry] if row and row.get("tradeDate")),
        default=None,
    )
    live = False
    if taipei_day_session(current) and last_available_at:
        try:
            live = (current - datetime.fromisoformat(last_available_at).astimezone(TAIPEI_TIMEZONE)).total_seconds() <= 10
        except ValueError:
            live = False
    state = "LIVE" if live else "SESSION_CLOSED" if (index_rows or industry) else "UNAVAILABLE"
    return {
        "schemaVersion": "ix0001-leadership-raw-v1",
        "recordType": "IX0001_LEADERSHIP_LATEST",
        "indexCode": "IX0001",
        "session": "DAY",
        "collectionEnabled": LEADERSHIP_COLLECTION_ENABLED,
        "state": state,
        "sourceMode": "LIVE_RAW" if live else "EOD_CONTEXT" if (index_rows or industry) else "UNAVAILABLE",
        "sourceTradeDate": source_trade_date,
        "lastAvailableAt": last_available_at,
        "indexContribution": index_rows,
        "industryContribution": industry,
        "simulatedMatching": simulated,
        "concepts": {
            "REALTIME_INDEX_CONTRIBUTION": "AVAILABLE",
            "HISTORICAL_EFFECTIVE_WEIGHTS": "SOURCE_GAP",
        },
        "LEADERSHIP_DESCRIPTIVE_ONLY": True,
        "NOT_PROMOTED": True,
        "NOT_A_TRADING_SIGNAL": True,
        "recommendation": False,
        "systemDirectionalSignal": False,
        "formalWeight": 0,
        "researchOnly": True,
        "executionAuthorized": False,
        "orderRoutesEnabled": False,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ShioajiReadOnly/1.0"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            global LAST_HEALTHY_AT
            with LOCK:
                queue_state = dict(QUEUE_STATE)
                subscriptions = [dict(item) for item in REQUIRED_SUBSCRIPTIONS.values()]
                txo_state = dict(TXO_COLLECTION_STATE)
                leadership_health = {
                    key: dict(value) for key, value in LEADERSHIP_HEALTH.items()
                }
            leadership_state = leadership_payload().get("state")
            for item in leadership_health.values():
                if item.get("availableAt"):
                    item["freshnessState"] = (
                        "LIVE" if leadership_state == "LIVE" else "SESSION_CLOSED"
                    )
            ledger_health = EVENT_LEDGER.health()
            writer_state = (
                "PASS"
                if queue_state["writerThreadAlive"]
                and queue_state["writerErrors"] == 0
                and not ledger_health.get("lowDisk", False)
                else "FAIL"
            )
            txo_state.update({
                "writerState": writer_state,
                "queueDepth": EVENT_QUEUE.qsize(),
                "dropped": queue_state["dropped"],
                "callbackErrors": queue_state["callbackErrors"],
                "writerErrors": queue_state["writerErrors"],
                "diskHealth": "LOW_DISK" if ledger_health.get("lowDisk", False) else "PASS",
            })
            if txo_state["enabled"] and (
                writer_state != "PASS"
                or queue_state["dropped"] > 0
                or queue_state["callbackErrors"] > 0
                or queue_state["writerErrors"] > 0
            ):
                txo_state["collectorState"] = "DEGRADED"
            subscriptions_ready = all(item["state"] == "RESTORED" for item in subscriptions)
            txo_ready = not txo_state["enabled"] or (
                txo_state["collectorState"] == "HEALTHY"
                and txo_state["restoredSubscriptionCount"] == txo_state["expectedSubscriptionCount"]
            )
            bridge_state = (
                "DEGRADED"
                if queue_state["sessionDown"] or writer_state != "PASS" or not subscriptions_ready or not txo_ready
                else "HEALTHY"
            )
            reason_code = (
                "SESSION_TERMINATED"
                if queue_state["sessionDown"]
                else "WRITER_UNAVAILABLE"
                if writer_state != "PASS"
                else "SUBSCRIPTION_RESTORE_FAILED"
                if not subscriptions_ready
                else "SUBSCRIPTION_RESTORE_FAILED"
                if not txo_ready
                else None
            )
            if bridge_state == "HEALTHY":
                LAST_HEALTHY_AT = datetime.now().astimezone().isoformat()
            self.respond(200, {
                "ok": True,
                "provider": "shioaji",
                "mode": "market_data_only",
                "executionAuthorized": False,
                "orderRoutesEnabled": False,
                "bridgeState": bridge_state,
                "reasonCode": reason_code,
                "bridgeStartedAt": BRIDGE_STARTED_AT,
                "lastHealthyAt": LAST_HEALTHY_AT,
                "requiredSubscriptions": subscriptions,
                "subscriptionState": "RESTORED" if subscriptions_ready else "PARTIAL",
                "writerState": writer_state,
                "txoCollection": txo_state,
                "leadership": leadership_health,
                "nativeSequenceAvailability": "UNAVAILABLE",
                "dataLossCertainty": "UNKNOWN_NO_NATIVE_SEQUENCE",
                "timestampLineageState": "QUALITY_INSUFFICIENT",
                "credentialProtection": "windows_dpapi_current_user",
                "processId": os.getpid(),
                "symbolsReceived": len(LATEST),
                "eventQueueDepth": EVENT_QUEUE.qsize(),
                "eventQueueCapacity": EVENT_QUEUE_CAPACITY,
                **queue_state,
                **ledger_health,
            })
            return
        if self.path == "/leadership":
            self.respond(200, {
                "ok": True,
                "provider": "shioaji",
                "mode": "market_data_only",
                "data": leadership_payload(),
                "executionAuthorized": False,
                "orderRoutesEnabled": False,
            })
            return
        if self.path == "/latest":
            with LOCK:
                data = dict(LATEST)
            self.respond(200, {
                "ok": True,
                "provider": "shioaji",
                "mode": "market_data_only",
                "data": data,
            })
            return
        self.respond(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/shutdown":
            global EXPECTED_STOP_REQUESTED
            EXPECTED_STOP_REQUESTED = True
            self.respond(202, {
                "ok": True,
                "mode": "market_data_only",
                "executionAuthorized": False,
                "orderRoutesEnabled": False,
                "action": "controlled_bridge_shutdown",
            })
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self.respond(404, {"ok": False, "error": "not_found"})

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        return


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is missing")
    return value


def startup_exit_code(error: Exception) -> tuple[int, str]:
    text = f"{type(error).__name__} {str(error)}".lower()[:4096]
    if "dpapi credential" in text or "api key" in text or "secret key" in text or "token" in text:
        return 77, "AUTH_OR_TOKEN_FAILURE"
    if "unauthorized" in text or "authentication" in text or "login" in text:
        return 80, "LOGIN_FAILED"
    if "network" in text or "connection" in text or "socket" in text or "timeout" in text or "dns" in text:
        return 78, "NETWORK_UNAVAILABLE"
    if isinstance(error, LookupError) or "subscribe" in text or "contract not found" in text:
        return 79, "SUBSCRIPTION_RESTORE_FAILED"
    return 1, "UNKNOWN_INSUFFICIENT_EVIDENCE"


def main() -> None:
    global SERVER, BRIDGE_STARTED_AT
    instance_mutex = acquire_single_instance()
    # Acquire the singleton port before login. A second launcher therefore exits
    # without consuming another broker connection or creating duplicate subscriptions.
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    SERVER = server
    writer = threading.Thread(target=event_writer, name="live-event-writer", daemon=True)
    writer.start()
    with LOCK:
        QUEUE_STATE["writerThreadAlive"] = True
    api: Any = None
    subscriptions: list[tuple[Any, Any, Any | None]] = []
    stop = threading.Event()
    bridge_started = False
    exit_code = 0

    def shutdown(*_: Any) -> None:
        if stop.is_set():
            return
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    try:
        credentials = load_credentials(CREDENTIAL_PATH)
        api_key = str(credentials["apiKey"])
        secret_key = str(credentials["secretKey"])
        simulation = not bool(credentials.get("production", False))

        api = sj.Shioaji(simulation=simulation)
        api.login(
            api_key=api_key,
            secret_key=secret_key,
            subscribe_trade=False,
        )
        bridge_started = True
        BRIDGE_STARTED_AT = datetime.now().astimezone().isoformat()
        record_lifecycle("bridge_started", simulation=simulation, processId=os.getpid())

        api.set_on_tick_stk_v1_callback(lambda tick: record("stock_tick", tick))
        api.set_on_quote_idx_v1_callback(lambda quote: record("index_quote", quote))
        api.set_on_tick_fop_v1_callback(lambda tick: record("futures_tick", tick))
        api.set_on_bidask_fop_v1_callback(
            lambda bidask: record("futures_bidask", bidask)
        )
        api.set_on_index_contribution_callback(record_index_contribution)
        api.set_on_industry_contribution_callback(record_industry_contribution)

        def on_session_down() -> None:
            nonlocal exit_code
            with LOCK:
                QUEUE_STATE["sessionDown"] = True
            exit_code = 75
            record_lifecycle(
                "session_down",
                recovery="restart_bridge_then_resubscribe",
                processId=os.getpid(),
            )
            if SERVER is not None:
                threading.Thread(target=SERVER.shutdown, daemon=True).start()

        api.set_session_down_callback(on_session_down)

        contract = api.contracts.get("2330")
        if contract is None:
            raise LookupError("stock contract not found: 2330")
        api.subscribe(contract, quote_type=sj.QuoteType.Tick)
        subscriptions.append((contract, sj.QuoteType.Tick, None))
        with LOCK:
            REQUIRED_SUBSCRIPTIONS["2330"]["state"] = "RESTORED"

        index = api.contracts.get("IX0001")
        if index is None:
            raise LookupError("TAIEX index contract not found: IX0001")
        api.subscribe(index, quote_type=sj.QuoteType.Quote)
        subscriptions.append((index, sj.QuoteType.Quote, None))
        with LOCK:
            REQUIRED_SUBSCRIPTIONS["IX0001"]["state"] = "RESTORED"

        if LEADERSHIP_COLLECTION_ENABLED:
            leadership_rankings = (
                ("IX0001_INDEX_ABS10", sj.ContributionRanking.Abs10),
                ("IX0001_INDEX_POSITIVE25", sj.ContributionRanking.Positive25),
                ("IX0001_INDEX_NEGATIVE25", sj.ContributionRanking.Negative25),
            )
            for subscription_key, ranking in leadership_rankings:
                api.subscribe(
                    index,
                    quote_type=sj.QuoteType.IndexContribution,
                    ranking=ranking,
                )
                subscriptions.append((index, sj.QuoteType.IndexContribution, ranking))
                with LOCK:
                    REQUIRED_SUBSCRIPTIONS[subscription_key]["state"] = "RESTORED"
            api.subscribe(index, quote_type=sj.QuoteType.IndustryContribution)
            subscriptions.append((index, sj.QuoteType.IndustryContribution, None))
            with LOCK:
                REQUIRED_SUBSCRIPTIONS["IX0001_INDUSTRY"]["state"] = "RESTORED"
                for health in LEADERSHIP_HEALTH.values():
                    health.update({
                        "subscriptionState": "RESTORED",
                        "reconnectState": "USES_EXISTING_SINGLE_BRIDGE",
                        "restorationState": "RESTORED",
                    })
        else:
            with LOCK:
                for health in LEADERSHIP_HEALTH.values():
                    health.update({
                        "subscriptionState": "DEFAULT_OFF",
                        "reconnectState": "OWNER_ACTIVATION_REQUIRED",
                        "restorationState": "NOT_REQUESTED",
                    })

        futures_contracts: list[tuple[str, str, Any]] = []
        for product_family, alias in (
            ("TX", "TXFR1"),
            ("MTX", "MXFR1"),
            ("TMF", "TMFR1"),
        ):
            futures_contract = api.contracts.get(alias)
            if futures_contract is None:
                raise LookupError(f"futures contract not found: {alias}")
            target_code = str(
                getattr(futures_contract, "target_code", None)
                or getattr(futures_contract, "code", None)
                or alias
            )
            metadata = {
                "productFamily": product_family,
                "subscriptionAlias": alias,
                "targetCode": target_code,
            }
            FUTURES_METADATA[alias] = metadata
            FUTURES_METADATA[target_code] = metadata
            futures_contracts.append((product_family, alias, futures_contract))
            with LOCK:
                REQUIRED_SUBSCRIPTIONS[product_family]["actualContract"] = target_code

        for _, _, futures_contract in futures_contracts:
            api.subscribe(futures_contract, quote_type=sj.QuoteType.Tick)
            subscriptions.append((futures_contract, sj.QuoteType.Tick, None))
            api.subscribe(futures_contract, quote_type=sj.QuoteType.BidAsk)
            subscriptions.append((futures_contract, sj.QuoteType.BidAsk, None))
        with LOCK:
            for product_family, _, _ in futures_contracts:
                REQUIRED_SUBSCRIPTIONS[product_family]["state"] = "RESTORED"
            QUEUE_STATE["subscriptionGeneration"] += 1
            QUEUE_STATE["sessionDown"] = False
            subscription_generation = QUEUE_STATE["subscriptionGeneration"]

        txo_enabled = os.getenv("DW4_TXO_COLLECTION_ENABLED", "").strip().lower() == "true"
        txo_config_path_raw = os.getenv("DW4_TXO_COLLECTION_CONFIG", "").strip()
        txo_config = load_activation_config(
            txo_enabled, Path(txo_config_path_raw) if txo_config_path_raw else None
        )
        if txo_config["enabled"]:
            calendar = load_governed_calendar(ROOT / "config" / "taifex-official-calendar-2026.json")
            all_txo_contracts = list(api.contracts.options("TXO"))
            nearest_contracts = select_nearest_expiry_contracts(all_txo_contracts, datetime.now().date())
            option_snapshots = list(api.snapshots(nearest_contracts))
            tx_snapshot = list(api.snapshots([futures_contracts[0][2]]))[0]
            underlying_price = float(getattr(tx_snapshot, "close", 0) or 0)
            maximum_contracts = txo_config["universe"]["ownerApprovedMaxContracts"]
            selected_options = select_governed_universe(
                nearest_contracts, option_snapshots, underlying_price, maximum_contracts
            )
            for option_contract in selected_options:
                code = str(getattr(option_contract, "code", "") or "")
                OPTIONS_METADATA[code] = {**contract_metadata(option_contract), "calendar": calendar}
                api.subscribe(option_contract, quote_type=sj.QuoteType.Tick)
                subscriptions.append((option_contract, sj.QuoteType.Tick, None))
                api.subscribe(option_contract, quote_type=sj.QuoteType.BidAsk)
                subscriptions.append((option_contract, sj.QuoteType.BidAsk, None))
            with LOCK:
                TXO_COLLECTION_STATE.update({
                    "enabled": True,
                    "collectorState": "HEALTHY",
                    "selectedContractCount": len(selected_options),
                    "subscriptionCount": len(selected_options) * 2,
                    "expectedSubscriptionCount": len(selected_options) * 2,
                    "restoredSubscriptionCount": len(selected_options) * 2,
                    "productionActivationApproved": True,
                })
        record_lifecycle(
            "subscriptions_ready",
            products=[
                "2330",
                "IX0001",
                *([
                    {
                        "productFamily": "IX0001_INDEX_CONTRIBUTION",
                        "rankings": ["abs10", "positive25", "negative25"],
                        "quoteTypes": ["IndexContribution"],
                    },
                    {
                        "productFamily": "IX0001_INDUSTRY_CONTRIBUTION",
                        "quoteTypes": ["IndustryContribution"],
                    },
                ] if LEADERSHIP_COLLECTION_ENABLED else []),
                *[
                    {
                        "productFamily": product_family,
                        "subscriptionAlias": alias,
                        "targetCode": str(
                            getattr(contract, "target_code", None)
                            or getattr(contract, "code", None)
                            or alias
                        ),
                        "quoteTypes": ["Tick", "BidAsk"],
                    }
                    for product_family, alias, contract in futures_contracts
                ],
            ],
            subscriptionGeneration=subscription_generation,
            processId=os.getpid(),
        )

        print(f"Shioaji read-only quotes: http://{HOST}:{PORT}/health")
        leadership_status = "enabled" if LEADERSHIP_COLLECTION_ENABLED else "default-off"
        print(f"Subscribed: IX0001 Quote, 2330, TXFR1, MXFR1, TMFR1; IX0001 Leadership {leadership_status}; TXO default-off")
        print("Order routes: disabled")
        server.serve_forever()
    finally:
        if bridge_started:
            with LOCK:
                stop_counters = {
                    "callbackErrors": QUEUE_STATE["callbackErrors"],
                    "dropped": QUEUE_STATE["dropped"],
                    "writerErrors": QUEUE_STATE["writerErrors"],
                }
            record_lifecycle("bridge_stopped", processId=os.getpid(), **stop_counters)
        EVENT_QUEUE.join()
        EVENT_QUEUE.put(None)
        writer.join(timeout=5)
        with LOCK:
            QUEUE_STATE["writerThreadAlive"] = writer.is_alive()
        if api is not None:
            for contract, quote_type, ranking in subscriptions:
                try:
                    if ranking is None:
                        api.unsubscribe(contract, quote_type=quote_type)
                    else:
                        api.unsubscribe(contract, quote_type=quote_type, ranking=ranking)
                except Exception:
                    pass
            try:
                api.logout()
            except Exception:
                pass
        server.server_close()
        SERVER = None
        release_single_instance(instance_mutex)
    if exit_code:
        raise SystemExit(exit_code)
    if EXPECTED_STOP_REQUESTED:
        raise SystemExit(76)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        code, reason = startup_exit_code(error)
        print(f"Shioaji bridge stopped before readiness: reasonCode={reason}", file=sys.stderr)
        raise SystemExit(code) from None
