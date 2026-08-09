"""Isolated Market State read-only forward collector.

Collects only market data:
- configured leadership stock Tick events;
- bounded TXO Bid/Ask surface around two nearest expiries.

No order, cancel, position, balance, margin, certificate or broker execution
operations exist in this module. Runtime evidence is written to a separate local
append-only hash-chain ledger under data/market-state/live-events/.
"""

from __future__ import annotations

import ctypes
import json
import os
import queue
import signal
import subprocess
import threading
import traceback
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any

import shioaji as sj

from live_event_ledger import LiveEventLedger
from market_state_collection import load_market_state_collection_config, select_txo_contracts


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "market-state-forward-collection.json"
CREDENTIAL_PATH = ROOT / ".shioaji.credentials.json"
CREDENTIAL_READER = ROOT / "scripts" / "read-shioaji-credentials.ps1"
EVENT_LEDGER = LiveEventLedger(ROOT / "data" / "market-state" / "live-events")
QUEUE_CAPACITY = 100_000
EVENT_QUEUE: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue(maxsize=QUEUE_CAPACITY)
STOP = threading.Event()
SINGLE_INSTANCE_MUTEX_NAME = "Local\\TaiwanStockMarketStateReadOnlyCollector"
STATE: dict[str, Any] = {
    "queued": 0,
    "written": 0,
    "dropped": 0,
    "callbackErrors": 0,
    "writerErrors": 0,
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
    if ctypes.get_last_error() == 183:
        kernel32.CloseHandle(handle)
        raise RuntimeError("market_state_readonly_collector_already_running")
    return handle


def release_single_instance(handle: Any) -> None:
    if os.name == "nt" and handle:
        ctypes.WinDLL("kernel32").CloseHandle(handle)


def load_credentials(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError("missing DPAPI credentials")
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    result = subprocess.run(
        [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(CREDENTIAL_READER), "-Path", str(path),
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


def enqueue(kind: str, payload: dict[str, Any]) -> None:
    try:
        EVENT_QUEUE.put_nowait((kind, payload))
        STATE["queued"] += 1
    except queue.Full:
        STATE["dropped"] += 1


def writer() -> None:
    while True:
        item = EVENT_QUEUE.get()
        try:
            if item is None:
                return
            kind, payload = item
            EVENT_LEDGER.append(kind, payload)
            STATE["written"] += 1
        except Exception:
            STATE["writerErrors"] += 1
        finally:
            EVENT_QUEUE.task_done()


def normalized_payload(data: Any) -> dict[str, Any]:
    payload = data.to_dict(raw=True) if hasattr(data, "to_dict") else vars(data)
    normalized = safe_value(payload)
    if not isinstance(normalized, dict):
        raise TypeError("callback payload must normalize to mapping")
    normalized["_received_at"] = datetime.now().astimezone().isoformat()
    normalized["_market_state_collection"] = True
    normalized["researchOnly"] = True
    normalized["executionAuthorized"] = False
    normalized["orderRoutesEnabled"] = False
    return normalized


def price_from_snapshot(snapshot: Any) -> float | None:
    for name in ("close", "avg_price", "open"):
        value = getattr(snapshot, name, None)
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number > 0:
            return number
    return None


def main() -> None:
    config = load_market_state_collection_config(CONFIG_PATH)
    if not config.get("enabled"):
        raise RuntimeError("market_state_forward_collection_disabled")

    instance_mutex = acquire_single_instance()
    api: Any = None
    subscriptions: list[tuple[Any, Any]] = []
    writer_thread = threading.Thread(target=writer, name="market-state-event-writer", daemon=True)
    writer_thread.start()

    option_metadata: dict[str, dict[str, Any]] = {}
    leadership_codes = list(config.get("leadership", {}).get("codes", []))

    def shutdown(*_: Any) -> None:
        STOP.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        credentials = load_credentials(CREDENTIAL_PATH)
        simulation = not bool(credentials.get("production", False))
        api = sj.Shioaji(simulation=simulation)
        api.login(
            api_key=str(credentials["apiKey"]),
            secret_key=str(credentials["secretKey"]),
            subscribe_trade=False,
        )

        enqueue("market_state_collector_started", {
            "code": "market-state-collector",
            "datetime": datetime.now().astimezone().isoformat(),
            "simulation": simulation,
            "config": config,
            "researchOnly": True,
            "executionAuthorized": False,
            "orderRoutesEnabled": False,
        })

        def stock_tick_callback(tick: Any) -> None:
            try:
                payload = normalized_payload(tick)
                payload["_evidence_block"] = "BREADTH_LEADERSHIP"
                payload["_basket_role"] = "LEADERSHIP_SEED_RAW_PRICE"
                enqueue("market_state_stock_tick", payload)
            except Exception as error:
                STATE["callbackErrors"] += 1
                payload = {"error": f"{type(error).__name__}:{str(error)[:160]}"}
                enqueue("market_state_callback_error", payload)

        def option_bidask_callback(bidask: Any) -> None:
            try:
                payload = normalized_payload(bidask)
                code = str(payload.get("code") or payload.get("Code") or "")
                metadata = option_metadata.get(code)
                if metadata:
                    payload["_option_contract"] = metadata
                payload["_evidence_block"] = "OPTIONS_VOLATILITY_POSITIONING"
                enqueue("market_state_option_bidask", payload)
            except Exception as error:
                STATE["callbackErrors"] += 1
                payload = {"error": f"{type(error).__name__}:{str(error)[:160]}"}
                enqueue("market_state_callback_error", payload)

        api.set_on_tick_stk_v1_callback(stock_tick_callback)
        api.set_on_bidask_fop_v1_callback(option_bidask_callback)

        if config.get("leadership", {}).get("enabled"):
            for code in leadership_codes:
                contract = api.contracts.get(code)
                if contract is None:
                    enqueue("market_state_subscription_missing", {"code": code, "securityType": "STK"})
                    continue
                api.subscribe(contract, quote_type=sj.QuoteType.Tick)
                subscriptions.append((contract, sj.QuoteType.Tick))

        selected_options: list[dict[str, Any]] = []
        if config.get("options", {}).get("enabled"):
            tx_contract = api.contracts.get("TXFR1")
            underlying_price = None
            if tx_contract is not None:
                try:
                    snapshots = api.snapshots([tx_contract])
                    if snapshots:
                        underlying_price = price_from_snapshot(snapshots[0])
                except Exception as error:
                    enqueue("market_state_underlying_snapshot_failed", {
                        "code": "TXFR1",
                        "error": f"{type(error).__name__}:{str(error)[:160]}",
                    })
            option_cfg = config["options"]
            if underlying_price:
                infos = api.contracts.options(option_cfg["root"])
                selected_options = select_txo_contracts(
                    infos,
                    underlying_price=underlying_price,
                    today=date.today(),
                    expiry_count=option_cfg["expiryCount"],
                    strikes_per_side=option_cfg["strikesPerSide"],
                )
                for metadata in selected_options:
                    contract = api.contracts.get(metadata["code"])
                    if contract is None:
                        enqueue("market_state_subscription_missing", {
                            "code": metadata["code"], "securityType": "OPT",
                        })
                        continue
                    option_metadata[metadata["code"]] = metadata
                    api.subscribe(contract, quote_type=sj.QuoteType.BidAsk)
                    subscriptions.append((contract, sj.QuoteType.BidAsk))
            else:
                enqueue("market_state_options_unavailable", {
                    "reason": "UNDERLYING_PRICE_UNAVAILABLE",
                })

        enqueue("market_state_subscriptions_ready", {
            "code": "market-state-collector",
            "datetime": datetime.now().astimezone().isoformat(),
            "leadershipCodes": leadership_codes,
            "leadershipSubscriptions": len([
                item for item in subscriptions if item[1] == sj.QuoteType.Tick
            ]),
            "optionSubscriptions": len(selected_options),
            "selectedOptions": selected_options,
            "subscriptionCount": len(subscriptions),
            "subscriptionSafetyCap": 160,
            "researchOnly": True,
            "executionAuthorized": False,
            "orderRoutesEnabled": False,
        })
        if len(subscriptions) > 160:
            raise RuntimeError(f"market_state_subscription_safety_cap_exceeded:{len(subscriptions)}")

        while not STOP.wait(1.0):
            pass
    except Exception as error:
        frame = traceback.extract_tb(error.__traceback__)[-1]
        enqueue("market_state_collector_error", {
            "code": "market-state-collector",
            "datetime": datetime.now().astimezone().isoformat(),
            "error": f"{type(error).__name__} at {Path(frame.filename).name}:{frame.lineno}: {str(error)[:200]}",
            "researchOnly": True,
            "executionAuthorized": False,
        })
        raise
    finally:
        if api is not None:
            for contract, quote_type in subscriptions:
                try:
                    api.unsubscribe(contract, quote_type=quote_type)
                except Exception:
                    pass
            try:
                api.logout()
            except Exception:
                pass
        enqueue("market_state_collector_stopped", {
            "code": "market-state-collector",
            "datetime": datetime.now().astimezone().isoformat(),
            **STATE,
            "researchOnly": True,
            "executionAuthorized": False,
        })
        EVENT_QUEUE.join()
        EVENT_QUEUE.put(None)
        writer_thread.join(timeout=5)
        release_single_instance(instance_mutex)


if __name__ == "__main__":
    main()
