"""Local, read-only Shioaji market-data bridge.

This process intentionally exposes only health and normalized quote snapshots.
It contains no order, cancel, position, balance, or certificate operations.
"""

from __future__ import annotations

import json
import os
import queue
import signal
import subprocess
import threading
import traceback
import ctypes
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import shioaji as sj
from live_event_ledger import LiveEventLedger


ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_PATH = ROOT / ".shioaji.credentials.json"
CREDENTIAL_READER = ROOT / "scripts" / "read-shioaji-credentials.ps1"
HOST = "127.0.0.1"
PORT = 8790
LATEST: dict[str, dict[str, Any]] = {}
FUTURES_METADATA: dict[str, dict[str, str]] = {}
LOCK = threading.Lock()
EVENT_LEDGER = LiveEventLedger(ROOT / "data" / "live-events")
SERVER: ThreadingHTTPServer | None = None
SINGLE_INSTANCE_MUTEX_NAME = "Local\\TaiwanStockShioajiReadOnlyBridge"
EVENT_QUEUE_CAPACITY = 50_000
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
        futures_metadata = FUTURES_METADATA.get(code)
        if futures_metadata:
            normalized["_product_family"] = futures_metadata["productFamily"]
            normalized["_subscription_alias"] = futures_metadata["subscriptionAlias"]
            normalized["_target_code"] = futures_metadata["targetCode"]
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
                LATEST[code] = stored
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


class Handler(BaseHTTPRequestHandler):
    server_version = "ShioajiReadOnly/1.0"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            with LOCK:
                queue_state = dict(QUEUE_STATE)
            self.respond(200, {
                "ok": True,
                "provider": "shioaji",
                "mode": "market_data_only",
                "executionAuthorized": False,
                "orderRoutesEnabled": False,
                "credentialProtection": "windows_dpapi_current_user",
                "processId": os.getpid(),
                "symbolsReceived": len(LATEST),
                "eventQueueDepth": EVENT_QUEUE.qsize(),
                "eventQueueCapacity": EVENT_QUEUE_CAPACITY,
                **queue_state,
                **EVENT_LEDGER.health(),
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


def main() -> None:
    global SERVER
    instance_mutex = acquire_single_instance()
    # Acquire the singleton port before login. A second launcher therefore exits
    # without consuming another broker connection or creating duplicate subscriptions.
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    SERVER = server
    writer = threading.Thread(target=event_writer, name="live-event-writer", daemon=True)
    writer.start()
    api: Any = None
    subscriptions: list[tuple[Any, Any]] = []
    stop = threading.Event()
    bridge_started = False

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
        api.login(api_key=api_key, secret_key=secret_key)
        bridge_started = True
        record_lifecycle("bridge_started", simulation=simulation, processId=os.getpid())

        api.set_on_tick_stk_v1_callback(lambda tick: record("stock_tick", tick))
        api.set_on_quote_idx_v1_callback(lambda quote: record("index_quote", quote))
        api.set_on_tick_fop_v1_callback(lambda tick: record("futures_tick", tick))
        api.set_on_bidask_fop_v1_callback(
            lambda bidask: record("futures_bidask", bidask)
        )

        def on_session_down() -> None:
            with LOCK:
                QUEUE_STATE["sessionDown"] = True
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
        subscriptions.append((contract, sj.QuoteType.Tick))

        index = api.contracts.get("IX0001")
        if index is None:
            raise LookupError("TAIEX index contract not found: IX0001")
        api.subscribe(index, quote_type=sj.QuoteType.Quote)
        subscriptions.append((index, sj.QuoteType.Quote))

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

        for _, _, futures_contract in futures_contracts:
            api.subscribe(futures_contract, quote_type=sj.QuoteType.Tick)
            subscriptions.append((futures_contract, sj.QuoteType.Tick))
            api.subscribe(futures_contract, quote_type=sj.QuoteType.BidAsk)
            subscriptions.append((futures_contract, sj.QuoteType.BidAsk))
        with LOCK:
            QUEUE_STATE["subscriptionGeneration"] += 1
            QUEUE_STATE["sessionDown"] = False
            subscription_generation = QUEUE_STATE["subscriptionGeneration"]
        record_lifecycle(
            "subscriptions_ready",
            products=[
                "2330",
                "IX0001",
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
        print("Subscribed: IX0001, 2330, TXFR1, MXFR1, TMFR1")
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
        server.server_close()
        SERVER = None
        release_single_instance(instance_mutex)


if __name__ == "__main__":
    main()
