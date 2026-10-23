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
from taifex_emergency_market import market_data_expected
from txo_live_chain import (
    contract_metadata,
    load_activation_config,
    load_governed_calendar,
    resolve_session_trade_date,
    select_governed_universe,
    select_nearest_expiry_contracts,
)


ROOT = Path(__file__).resolve().parent.parent
TX_TRADING_CALENDAR = load_governed_calendar(
    ROOT / "config" / "taifex-official-calendar-2026.json"
)
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
SHIOAJI_API: Any | None = None
STOCK_NAME_CACHE: dict[str, str] = {}
TWSE_INDUSTRY_NAMES: dict[str, str] = {
    "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維",
    "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業",
    "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "14": "建材營造",
    "15": "航運業", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨",
    "19": "綜合", "20": "其他", "21": "化學工業", "22": "生技醫療業",
    "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業", "26": "光電業",
    "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
    "31": "其他電子業", "35": "綠能環保", "36": "數位雲端", "37": "運動休閒",
    "38": "居家生活",
}
LOCK = threading.Lock()
EVENT_LEDGER = LiveEventLedger(ROOT / "data" / "live-events")
SERVER: ThreadingHTTPServer | None = None
SINGLE_INSTANCE_MUTEX_NAME = "Local\\TaiwanStockShioajiReadOnlyBridge"
EVENT_QUEUE_CAPACITY = 50_000
TAIPEI_TIMEZONE = timezone(timedelta(hours=8))
INDUSTRY_POINTS_TOLERANCE = 0.1
QUOTE_DELIVERY_GRACE_SECONDS = 30
QUOTE_STALE_SECONDS = 300
QUOTE_RESUBSCRIBE_DELAYS_SECONDS = (0, 5, 20)
RECONNECT_REPLAY_LOCK = threading.Lock()
SUBSCRIPTION_RECOVERY_LOCK = threading.Lock()
RECONNECT_REPLAY_STATE: dict[str, Any] = {
    "providerGeneration": 0,
    "inFlightGeneration": None,
    "lastCompletedGeneration": 0,
    "pendingReplays": [],
}
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
    "lastProviderEvent": None,
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
    "TX": {"product": "TX", "subscriptionAlias": "TXFR1", "quoteTypes": ["Tick", "BidAsk"], "state": "PENDING", "actualContract": None, "lastObservedAt": None, "quoteTypeHealth": {}},
    "MTX": {"product": "MTX", "subscriptionAlias": "MXFR1", "quoteTypes": ["Tick", "BidAsk"], "state": "PENDING", "actualContract": None, "lastObservedAt": None, "quoteTypeHealth": {}},
    "TMF": {"product": "TMF", "subscriptionAlias": "TMFR1", "quoteTypes": ["Tick", "BidAsk"], "state": "PENDING", "actualContract": None, "lastObservedAt": None, "quoteTypeHealth": {}},
    "2330": {"product": "2330", "subscriptionAlias": "2330", "quoteTypes": ["Tick"], "state": "PENDING", "actualContract": "2330", "lastObservedAt": None},
    "IX0001": {"product": "IX0001", "subscriptionAlias": "IX0001", "quoteTypes": ["Quote"], "state": "PENDING", "actualContract": "IX0001", "lastObservedAt": None},
}
for _product in ("TX", "MTX", "TMF"):
    REQUIRED_SUBSCRIPTIONS[_product]["quoteTypeHealth"] = {
        quote_type: {
            "quoteType": quote_type,
            "subscriptionState": "PENDING",
            "deliveryState": "PENDING",
            "freshnessState": "UNAVAILABLE",
            "subscribedAt": None,
            "lastObservedAt": None,
            "lastResubscribeAt": None,
            "resubscribeAttempts": 0,
            "recoveryState": "NOT_REQUIRED",
        }
        for quote_type in ("Tick", "BidAsk")
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


def ledger_hash_safe_numbers(value: Any) -> Any:
    """Normalize whole-number floats so Python and JS canonical JSON hash identically."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, Decimal):
        parsed = float(value)
        return int(parsed) if parsed.is_integer() else parsed
    if isinstance(value, (list, tuple)):
        return [ledger_hash_safe_numbers(item) for item in value]
    if isinstance(value, Mapping):
        return {
            str(key): ledger_hash_safe_numbers(item)
            for key, item in value.items()
        }
    return ledger_hash_safe_numbers(safe_value(value))


def resolve_stock_name(code: str) -> str | None:
    key = str(code or "").strip()
    if not key:
        return None
    cached = STOCK_NAME_CACHE.get(key)
    if cached:
        return cached
    api = SHIOAJI_API
    if api is None:
        return None
    try:
        contract = api.contracts.get(key)
        if contract is None:
            return None
        # Shioaji 1.7 get() returns an identity-only Contract; names live in info().
        info = api.contracts.info(contract)
        if getattr(info, "code", None) != key:
            return None
        raw_name = getattr(info, "name", None)
        name = raw_name.strip() if isinstance(raw_name, str) else ""
    except Exception:
        return None
    if name:
        STOCK_NAME_CACHE[key] = name
        return name
    return None


def resolve_industry_name(category: str) -> str | None:
    key = str(category or "").strip().zfill(2)
    return TWSE_INDUSTRY_NAMES.get(key)


def _iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
    except (TypeError, ValueError):
        return None


def tx_market_data_expected(now: datetime | None = None) -> bool:
    current = (now or datetime.now(TAIPEI_TIMEZONE)).astimezone(TAIPEI_TIMEZONE)
    try:
        return market_data_expected(current,
            ROOT / "config" / "taifex-official-calendar-2026.json",
            ROOT / "config" / "taifex-emergency-closure-20261023.json",
            allow_candidate=os.environ.get("TAIFEX_ALLOW_CANDIDATE_CLOSURE") == "true")
    except (RuntimeError, ValueError, OSError, KeyError, TypeError):
        # Invalid present governance must not trigger automatic subscriptions.
        return False


def mark_quote_subscribed(
    product: str,
    quote_type: str,
    now: datetime | None = None,
    reset_delivery: bool = False,
) -> None:
    observed_at = (now or datetime.now().astimezone()).isoformat()
    with LOCK:
        subscription = REQUIRED_SUBSCRIPTIONS[product]
        capability = subscription["quoteTypeHealth"][quote_type]
        capability["subscriptionState"] = "RESTORED"
        capability["subscribedAt"] = observed_at
        if reset_delivery:
            capability["previousLastObservedAt"] = capability.get("lastObservedAt")
            capability["lastObservedAt"] = None
            capability["deliveryState"] = "PENDING"
            capability["freshnessState"] = "UNAVAILABLE"
            capability["recoveryState"] = "WAITING_FOR_DELIVERY"
        subscription["state"] = "RESTORED"


def mark_quote_delivery(product: str, quote_type: str, observed_at: str) -> None:
    with LOCK:
        subscription = REQUIRED_SUBSCRIPTIONS.get(product)
        capability = subscription and subscription.get("quoteTypeHealth", {}).get(quote_type)
        if capability is None:
            if subscription is not None:
                subscription["lastObservedAt"] = observed_at
            return
        capability.update({
            "deliveryState": "LIVE",
            "freshnessState": "LIVE",
            "lastObservedAt": observed_at,
            "recoveryState": "DELIVERY_OBSERVED",
        })
        subscription["lastObservedAt"] = observed_at


def quote_delivery_snapshot(
    now: datetime | None = None,
    market_should_be_active: bool | None = None,
) -> list[dict[str, Any]]:
    """Return quote-type delivery truth without treating subscribe return as delivery."""
    current = now or datetime.now().astimezone()
    active_session = (
        tx_market_data_expected(current)
        if market_should_be_active is None
        else market_should_be_active
    )
    with LOCK:
        snapshot = json.loads(json.dumps(list(REQUIRED_SUBSCRIPTIONS.values())))
    for subscription in snapshot:
        capabilities = subscription.get("quoteTypeHealth") or {}
        if not capabilities:
            continue
        delivery_failure = False
        for capability in capabilities.values():
            last_observed = _iso_datetime(capability.get("lastObservedAt"))
            subscribed_at = _iso_datetime(capability.get("subscribedAt"))
            if (
                capability.get("subscriptionState") == "FAILED"
                or capability.get("deliveryState") == "FAILED"
            ):
                capability["deliveryState"] = "FAILED"
                capability["freshnessState"] = "UNAVAILABLE"
                delivery_failure = True
                continue
            if last_observed:
                age_seconds = (current - last_observed.astimezone(current.tzinfo)).total_seconds()
                capability["freshnessState"] = (
                    "LIVE"
                    if age_seconds <= QUOTE_STALE_SECONDS
                    else "STALE"
                    if active_session
                    else "SESSION_CLOSED"
                )
                if active_session and age_seconds > QUOTE_STALE_SECONDS:
                    capability["deliveryState"] = "STALE"
                    delivery_failure = True
                elif capability.get("deliveryState") != "LIVE":
                    capability["deliveryState"] = "LIVE"
            elif (
                capability.get("subscriptionState") == "RESTORED"
                and active_session
                and subscribed_at
                and (current - subscribed_at.astimezone(current.tzinfo)).total_seconds()
                >= QUOTE_DELIVERY_GRACE_SECONDS
            ):
                capability["deliveryState"] = "MISSING"
                capability["freshnessState"] = "UNAVAILABLE"
                delivery_failure = True
            else:
                capability["deliveryState"] = "PENDING"
                capability["freshnessState"] = "UNAVAILABLE"
        if delivery_failure:
            subscription["state"] = "PARTIAL"
        elif any(
            capability.get("deliveryState") != "LIVE"
            for capability in capabilities.values()
        ):
            subscription["state"] = "PENDING"
        else:
            subscription["state"] = "RESTORED"
    return snapshot


def _recover_missing_quote_types_locked(
    api: Any,
    futures_contracts: Mapping[str, Any],
    now: datetime | None = None,
    market_should_be_active: bool | None = None,
) -> int:
    """Retry only silently missing futures quote types, with a bounded budget."""
    current = now or datetime.now().astimezone()
    recovered = 0
    active = tx_market_data_expected(current) if market_should_be_active is None else market_should_be_active
    if not active:
        return 0
    for subscription in quote_delivery_snapshot(current, market_should_be_active):
        product = subscription["product"]
        contract = futures_contracts.get(product)
        if contract is None:
            continue
        for quote_type, capability in (subscription.get("quoteTypeHealth") or {}).items():
            if capability.get("deliveryState") not in {"MISSING", "STALE", "FAILED"}:
                continue
            attempts = int(capability.get("resubscribeAttempts") or 0)
            if attempts >= len(QUOTE_RESUBSCRIBE_DELAYS_SECONDS):
                with LOCK:
                    REQUIRED_SUBSCRIPTIONS[product]["quoteTypeHealth"][quote_type]["recoveryState"] = "EXHAUSTED"
                continue
            last_retry = _iso_datetime(capability.get("lastResubscribeAt"))
            delay = QUOTE_RESUBSCRIBE_DELAYS_SECONDS[attempts]
            if last_retry and (current - last_retry.astimezone(current.tzinfo)).total_seconds() < delay:
                continue
            provider_quote_type = sj.QuoteType.Tick if quote_type == "Tick" else sj.QuoteType.BidAsk
            retry_at = current.isoformat()
            with LOCK:
                live = REQUIRED_SUBSCRIPTIONS[product]["quoteTypeHealth"][quote_type]
                live["resubscribeAttempts"] = attempts + 1
                live["lastResubscribeAt"] = retry_at
                live["recoveryState"] = "RETRYING"
            try:
                api.subscribe(contract, quote_type=provider_quote_type)
                recovered += 1
                with LOCK:
                    live = REQUIRED_SUBSCRIPTIONS[product]["quoteTypeHealth"][quote_type]
                    live["subscriptionState"] = "RESTORED"
                    live["subscribedAt"] = retry_at
                    live["previousLastObservedAt"] = live.get("lastObservedAt")
                    live["lastObservedAt"] = None
                    live["deliveryState"] = "PENDING"
                    live["freshnessState"] = "UNAVAILABLE"
                    live["recoveryState"] = "WAITING_FOR_DELIVERY"
                record_lifecycle(
                    "quote_type_resubscribe",
                    product=product,
                    quoteType=quote_type,
                    attempt=attempts + 1,
                    actualContract=subscription.get("actualContract"),
                )
            except Exception as error:
                with LOCK:
                    live = REQUIRED_SUBSCRIPTIONS[product]["quoteTypeHealth"][quote_type]
                    live["subscriptionState"] = "FAILED"
                    live["deliveryState"] = "FAILED"
                    live["recoveryState"] = "FAILED"
                    live["lastRecoveryError"] = f"{type(error).__name__}: {str(error)[:180]}"
    return recovered


def recover_missing_quote_types(
    api: Any,
    futures_contracts: Mapping[str, Any],
    now: datetime | None = None,
    market_should_be_active: bool | None = None,
) -> int:
    with SUBSCRIPTION_RECOVERY_LOCK:
        return _recover_missing_quote_types_locked(
            api, futures_contracts, now, market_should_be_active
        )


def quote_delivery_watchdog(api: Any, futures_contracts: Mapping[str, Any], stop: threading.Event) -> None:
    while not stop.wait(5):
        recover_missing_quote_types(api, futures_contracts)


def _resubscribe_futures_after_reconnect_locked(api: Any, futures_contracts: Mapping[str, Any]) -> None:
    """Restore both independent FOP capabilities after an SDK session reconnect."""
    if not futures_contracts:
        return
    with LOCK:
        QUEUE_STATE["subscriptionGeneration"] += 1
        subscription_generation = QUEUE_STATE["subscriptionGeneration"]
        for product in futures_contracts:
            for capability in REQUIRED_SUBSCRIPTIONS[product]["quoteTypeHealth"].values():
                capability["resubscribeAttempts"] = 0
                capability["lastResubscribeAt"] = None
                capability["lastRecoveryError"] = None
                capability["recoveryState"] = "WAITING_FOR_DELIVERY"
    record_lifecycle(
        "futures_reconnect_resubscribe_started",
        subscriptionGeneration=subscription_generation,
        products=sorted(futures_contracts),
    )
    for product, contract in futures_contracts.items():
        for quote_type, provider_quote_type in (
            ("Tick", sj.QuoteType.Tick),
            ("BidAsk", sj.QuoteType.BidAsk),
        ):
            mark_quote_subscribed(product, quote_type, reset_delivery=True)
            try:
                api.subscribe(contract, quote_type=provider_quote_type)
                record_lifecycle(
                    "quote_type_reconnect_resubscribe",
                    product=product,
                    quoteType=quote_type,
                    actualContract=REQUIRED_SUBSCRIPTIONS[product].get("actualContract"),
                    subscriptionGeneration=subscription_generation,
                )
            except Exception as error:
                with LOCK:
                    capability = REQUIRED_SUBSCRIPTIONS[product]["quoteTypeHealth"][quote_type]
                    capability["subscriptionState"] = "FAILED"
                    capability["deliveryState"] = "FAILED"
                    capability["recoveryState"] = "FAILED"
                    capability["lastRecoveryError"] = f"{type(error).__name__}: {str(error)[:180]}"


def resubscribe_futures_after_reconnect(api: Any, futures_contracts: Mapping[str, Any]) -> None:
    with SUBSCRIPTION_RECOVERY_LOCK:
        _resubscribe_futures_after_reconnect_locked(api, futures_contracts)


def note_provider_reconnecting() -> int:
    with RECONNECT_REPLAY_LOCK:
        RECONNECT_REPLAY_STATE["providerGeneration"] += 1
        generation = RECONNECT_REPLAY_STATE["providerGeneration"]
    with LOCK:
        QUEUE_STATE["providerReconnectGeneration"] = generation
    return generation


def schedule_futures_resubscribe_after_reconnect(
    api: Any,
    futures_contracts: Mapping[str, Any],
    provider_generation: int | None = None,
) -> bool:
    """Replay once per provider 12->13 generation; queue overlapping generations."""
    with RECONNECT_REPLAY_LOCK:
        requested = int(provider_generation or RECONNECT_REPLAY_STATE["providerGeneration"])
        if requested <= 0:
            RECONNECT_REPLAY_STATE["providerGeneration"] = 1
            requested = 1
        pending = RECONNECT_REPLAY_STATE["pendingReplays"]
        if (
            requested <= RECONNECT_REPLAY_STATE["lastCompletedGeneration"]
            or requested == RECONNECT_REPLAY_STATE["inFlightGeneration"]
            or any(item[0] == requested for item in pending)
        ):
            return False
        request = (requested, api, dict(futures_contracts))
        if RECONNECT_REPLAY_STATE["inFlightGeneration"] is not None:
            pending.append(request)
            return True
        RECONNECT_REPLAY_STATE["inFlightGeneration"] = requested

    def replay() -> None:
        active_request = request
        while True:
            generation, active_api, active_contracts = active_request
            try:
                resubscribe_futures_after_reconnect(active_api, active_contracts)
            except Exception as error:
                record_callback_error(error)
            with RECONNECT_REPLAY_LOCK:
                RECONNECT_REPLAY_STATE["lastCompletedGeneration"] = max(
                    RECONNECT_REPLAY_STATE["lastCompletedGeneration"], generation
                )
                pending_replays = RECONNECT_REPLAY_STATE["pendingReplays"]
                if not pending_replays:
                    RECONNECT_REPLAY_STATE["inFlightGeneration"] = None
                    break
                active_request = pending_replays.pop(0)
                RECONNECT_REPLAY_STATE["inFlightGeneration"] = active_request[0]

    threading.Thread(
        target=replay,
        name="futures-reconnect-resubscribe",
        daemon=True,
    ).start()
    return True


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
        code = str(row.get("code") or "")
        entries.append({
            "code": code,
            "name": resolve_stock_name(code),
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
        category = str(row.get("category") or "")
        entries.append({
            "category": category,
            "categoryName": resolve_industry_name(category),
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
        normalized = normalize_index_contribution(data)
        normalized["ledgerCanonicalization"] = "JS_SAFE_NUMBERS_V1"
        enqueue(
            "ix0001_index_contribution",
            ledger_hash_safe_numbers(normalized),
        )
    except Exception as error:
        record_callback_error(error)


def record_industry_contribution(data: Any) -> None:
    try:
        normalized = normalize_industry_contribution(data)
        normalized["ledgerCanonicalization"] = "JS_SAFE_NUMBERS_V1"
        enqueue(
            "ix0001_industry_contribution",
            ledger_hash_safe_numbers(normalized),
        )
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


def validate_futures_executed_tick(payload: Mapping[str, Any]) -> None:
    if not str(payload.get("productFamily") or "").strip():
        raise ValueError("FOP_TICK_PRODUCT_FAMILY_MISSING")
    if not str(payload.get("actualContract") or "").strip():
        raise ValueError("FOP_TICK_ACTUAL_CONTRACT_MISSING")
    if _iso_datetime(payload.get("eventTime")) is None:
        raise ValueError("FOP_TICK_EVENT_TIME_INVALID")
    for field in ("price", "executedVolume"):
        try:
            value = Decimal(str(payload.get(field)))
        except Exception as error:
            raise ValueError(f"FOP_TICK_{field.upper()}_INVALID") from error
        if not value.is_finite() or value <= 0:
            raise ValueError(f"FOP_TICK_{field.upper()}_INVALID")


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
        if kind == "futures_tick" and futures_metadata is None:
            raise ValueError("FOP_TICK_CONTRACT_NOT_GOVERNED")
        if futures_metadata:
            normalized["_product_family"] = futures_metadata["productFamily"]
            normalized["_subscription_alias"] = futures_metadata["subscriptionAlias"]
            normalized["_target_code"] = futures_metadata["targetCode"]
            normalized["productFamily"] = futures_metadata["productFamily"]
            normalized["subscriptionAlias"] = futures_metadata["subscriptionAlias"]
            normalized["targetCode"] = futures_metadata["targetCode"]
            normalized["actualContract"] = futures_metadata["targetCode"]
            if kind == "futures_tick":
                normalized["eventTime"] = normalized.get("datetime") or normalized.get("timestamp")
                normalized["price"] = normalized.get("close")
                normalized["executedVolume"] = normalized.get("volume")
                validate_futures_executed_tick(normalized)
        enqueue(kind, normalized)
    except Exception as error:
        record_callback_error(error)


def event_writer() -> None:
    while True:
        item = EVENT_QUEUE.get()
        try:
            if item is None:
                return
            kind, normalized = item
            code = str(normalized.get("code") or normalized.get("Code") or kind)
            stored = EVENT_LEDGER.append(kind, normalized)
            quote_type = {
                "futures_tick": "Tick",
                "futures_bidask": "BidAsk",
                "stock_tick": "Tick",
                "index_quote": "Quote",
            }.get(kind)
            if quote_type:
                product = str(normalized.get("_product_family") or code)
                mark_quote_delivery(product, quote_type, normalized["_received_at"])
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


def writer_health_state(
    queue_state: Mapping[str, Any], ledger_health: Mapping[str, Any]
) -> str:
    return (
        "PASS"
        if queue_state.get("writerThreadAlive") is True
        and int(queue_state.get("writerErrors") or 0) == 0
        and int(queue_state.get("dropped") or 0) == 0
        and int(queue_state.get("callbackErrors") or 0) == 0
        and ledger_health.get("lowDisk") is not True
        else "FAIL"
    )


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
                txo_state = dict(TXO_COLLECTION_STATE)
                leadership_health = {
                    key: dict(value) for key, value in LEADERSHIP_HEALTH.items()
                }
            subscriptions = quote_delivery_snapshot()
            leadership_state = leadership_payload().get("state")
            for item in leadership_health.values():
                if item.get("availableAt"):
                    item["freshnessState"] = (
                        "LIVE" if leadership_state == "LIVE" else "SESSION_CLOSED"
                    )
            ledger_health = EVENT_LEDGER.health()
            writer_state = writer_health_state(queue_state, ledger_health)
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
            subscriptions_pending = any(item["state"] == "PENDING" for item in subscriptions)
            missing_quote_type = any(
                capability.get("deliveryState") in {"MISSING", "STALE", "FAILED"}
                for item in subscriptions
                for capability in (item.get("quoteTypeHealth") or {}).values()
            )
            quote_types_pending = any(
                capability.get("deliveryState") != "LIVE"
                for item in subscriptions
                for capability in (item.get("quoteTypeHealth") or {}).values()
            )
            txo_ready = not txo_state["enabled"] or (
                txo_state["collectorState"] == "HEALTHY"
                and txo_state["restoredSubscriptionCount"] == txo_state["expectedSubscriptionCount"]
            )
            bridge_state = (
                "DEGRADED"
                if queue_state["sessionDown"] or writer_state != "PASS" or missing_quote_type or not txo_ready
                else "STARTING"
                if subscriptions_pending or not subscriptions_ready
                else "HEALTHY"
            )
            reason_code = (
                "SESSION_TERMINATED"
                if queue_state["sessionDown"]
                else "WRITER_UNAVAILABLE"
                if writer_state != "PASS"
                else "MISSING_REQUIRED_QUOTE_TYPE"
                if missing_quote_type
                else "DATA_RESUME_NOT_OBSERVED"
                if subscriptions_pending
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
                "formalWeight": 0,
                "researchOnly": True,
                "executionAuthorized": False,
                "orderRoutesEnabled": False,
                "bridgeState": bridge_state,
                "reasonCode": reason_code,
                "bridgeStartedAt": BRIDGE_STARTED_AT,
                "lastHealthyAt": LAST_HEALTHY_AT,
                "requiredSubscriptions": subscriptions,
                "subscriptionState": "RESTORED" if subscriptions_ready else "PENDING" if subscriptions_pending else "PARTIAL",
                "quoteTypeDeliveryState": (
                    "PARTIAL"
                    if missing_quote_type
                    else "PENDING"
                    if quote_types_pending
                    else "PASS"
                ),
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


def require_open_operating_session() -> None:
    if not tx_market_data_expected():
        print("BROKER_START_CALENDAR_BLOCKED", file=sys.stderr)
        raise SystemExit(76)


def main() -> None:
    global SERVER, BRIDGE_STARTED_AT, SHIOAJI_API
    require_open_operating_session()
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
    futures_contract_map: dict[str, Any] = {}
    stop = threading.Event()
    watchdog: threading.Thread | None = None
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
        require_open_operating_session()
        credentials = load_credentials(CREDENTIAL_PATH)
        api_key = str(credentials["apiKey"])
        secret_key = str(credentials["secretKey"])
        simulation = not bool(credentials.get("production", False))

        api = sj.Shioaji(simulation=simulation)
        require_open_operating_session()
        api.login(
            api_key=api_key,
            secret_key=secret_key,
            subscribe_trade=False,
        )
        SHIOAJI_API = api
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

        def on_provider_event(response_code: int, event_code: int, info: str, event: str) -> None:
            try:
                observed_at = datetime.now().astimezone().isoformat()
                provider_event = {
                    "responseCode": int(response_code),
                    "eventCode": int(event_code),
                    "info": str(info)[:300],
                    "event": str(event)[:300],
                    "observedAt": observed_at,
                }
                with LOCK:
                    QUEUE_STATE["lastProviderEvent"] = provider_event
                record_lifecycle("provider_event", **provider_event)
                if event_code == 12 or "reconnecting" in str(event).lower():
                    note_provider_reconnecting()
                if (
                    not stop.is_set()
                    and (event_code == 13 or "reconnected" in str(event).lower())
                ):
                    schedule_futures_resubscribe_after_reconnect(
                        api,
                        dict(futures_contract_map),
                    )
            except Exception as error:
                record_callback_error(error)

        api.set_event_callback(on_provider_event)

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

        futures_contract_map.update({
            product_family: contract
            for product_family, _, contract in futures_contracts
        })
        for product_family, _, futures_contract in futures_contracts:
            api.subscribe(futures_contract, quote_type=sj.QuoteType.Tick)
            subscriptions.append((futures_contract, sj.QuoteType.Tick, None))
            mark_quote_subscribed(product_family, "Tick")
            api.subscribe(futures_contract, quote_type=sj.QuoteType.BidAsk)
            subscriptions.append((futures_contract, sj.QuoteType.BidAsk, None))
            mark_quote_subscribed(product_family, "BidAsk")
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
        watchdog = threading.Thread(
            target=quote_delivery_watchdog,
            args=(api, futures_contract_map, stop),
            name="quote-delivery-watchdog",
            daemon=True,
        )
        watchdog.start()

        print(f"Shioaji read-only quotes: http://{HOST}:{PORT}/health")
        leadership_status = "enabled" if LEADERSHIP_COLLECTION_ENABLED else "default-off"
        print(f"Subscribed: IX0001 Quote, 2330, TXFR1, MXFR1, TMFR1; IX0001 Leadership {leadership_status}; TXO default-off")
        print("Order routes: disabled")
        server.serve_forever()
    finally:
        stop.set()
        if watchdog is not None:
            watchdog.join(timeout=5)
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
