"""Synthetic offline wire fixtures using actual producer functions and ledger.

Never import the bridge/SDK: compile only its pure callback/queue functions.
The complete pure ledger module runs with a frozen synthetic clock and writes
only newly created fixture paths supplied by the test process.
"""

import ast
import copy
import hashlib
import json
import queue
import sys
import threading
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any


REPO = Path(sys.argv[1])
OUT = Path(sys.argv[2])
NOW = datetime.fromisoformat("2026-11-02T02:00:00.200+00:00")


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz is None else NOW.astimezone(tz)


bridge_path = REPO / "broker/shioaji_readonly_bridge.py"
bridge_source = bridge_path.read_text(encoding="utf-8")
names = {"safe_value", "enqueue", "record"}
functions = [
    node for node in ast.parse(bridge_source).body
    if isinstance(node, ast.FunctionDef) and node.name in names
]
assert len(functions) == len(names)
namespace = {
    "Any": Any, "Mapping": Mapping, "Decimal": Decimal,
    "datetime": FrozenDatetime, "date": date, "time": time, "Enum": Enum,
    "queue": queue, "LOCK": threading.Lock(), "EVENT_QUEUE": queue.Queue(maxsize=10),
    "QUEUE_STATE": {"queued": 0, "dropped": 0}, "OPTIONS_METADATA": {},
    "FUTURES_METADATA": {"TXFK6": {
        "productFamily": "TX", "subscriptionAlias": "TXFR1", "targetCode": "TXFK6",
    }},
}


def callback_error(error):
    raise error


namespace["record_callback_error"] = callback_error
exec(compile(ast.Module(body=functions, type_ignores=[]), str(bridge_path) + ":FUNCTION_AST_ONLY", "exec"), namespace)
ledger_path = REPO / "broker/live_event_ledger.py"
ledger_source = ledger_path.read_text(encoding="utf-8")
ledger_namespace = {}
exec(compile(ledger_source, str(ledger_path) + ":PURE_MODULE", "exec"), ledger_namespace)
ledger_namespace["datetime"] = FrozenDatetime


class SyntheticBidAsk:
    def __init__(self, payload):
        self.payload = payload

    def to_dict(self, raw=True):
        assert raw is True
        return self.payload


base = {
    "code": "TXFK6", "datetime": "2026-11-02T10:00:00+08:00", "simtrade": False,
    "bid_price": [10000, 9999, 9998, 9997, 9996],
    "ask_price": [10001, 10002, 10003, 10004, 10005],
    "bid_volume": [10, 20, 30, 40, 50], "ask_volume": [10, 20, 30, 40, 50],
}
cases = {"integer_control": copy.deepcopy(base)}
for name, fields, cast in (
    ("decimal_prices", ("bid_price", "ask_price"), lambda value: Decimal(f"{value}.0")),
    ("float_prices", ("bid_price", "ask_price"), float),
    ("decimal_volumes", ("bid_volume", "ask_volume"), lambda value: Decimal(f"{value}.0")),
):
    cases[name] = copy.deepcopy(base)
    for field in fields:
        cases[name][field] = [cast(value) for value in base[field]]
cases["decimal_auxiliary"] = {**copy.deepcopy(base), "synthetic_auxiliary": Decimal("1.0")}
cases["fractional_auxiliary_control"] = {**copy.deepcopy(base), "synthetic_auxiliary": Decimal("0.25")}
cases["nested_python_lexemes"] = {
    **copy.deepcopy(base),
    "synthetic_auxiliary": {
        "tiny": Decimal("0.0000001"), "negative_zero": Decimal("-0.0"),
        "keys": {"2": "two", "10": "ten", "😀": "astral", "\ue000": "private-use"},
        "nested": [{"whole": Decimal("1.0"), "label": "純合成\\label\nfixture"}],
    },
}


def verify_hash(record):
    body = {key: value for key, value in record.items() if key != "recordHash"}
    canonical = ledger_namespace["canonical"](body)
    computed = hashlib.sha256((record["previousHash"] + "\n" + canonical).encode("utf-8")).hexdigest()
    assert computed == record["recordHash"]
    return canonical


manifest = {"syntheticOnly": True, "bridgeModuleImported": False, "sdkImported": False, "cases": {}}
for name, payload in cases.items():
    directory = OUT / name / "live-events"
    assert not directory.exists()
    ledger = ledger_namespace["LiveEventLedger"](directory)
    namespace["record"]("futures_bidask", SyntheticBidAsk(payload))
    kind, normalized = namespace["EVENT_QUEUE"].get_nowait()
    # Same unmodified append method/arguments as the actual event_writer.
    record = ledger.append(kind, normalized)
    canonical = verify_hash(record)
    raw = ledger.current_file.read_bytes()
    manifest["cases"][name] = {
        "file": str(ledger.current_file), "recordHash": record["recordHash"],
        "wireSha256": hashlib.sha256(raw).hexdigest(), "pythonRawHashVerified": True,
        "bidPriceTypes": [type(value).__name__ for value in normalized["bid_price"]],
        "bidVolumeTypes": [type(value).__name__ for value in normalized["bid_volume"]],
    }
    (directory.parent / "python-canonical-body.json").write_text(canonical + "\n", encoding="utf-8")

# Deliberately hostile, hash-valid synthetic records test retained reader
# validation. They are separate artifacts, never claimed as producer output.
original = json.loads(Path(manifest["cases"]["decimal_prices"]["file"]).read_text(encoding="utf-8"))
for name, mutate in (
    ("unsafe_execution", lambda record: record.update(executionAuthorized=True)),
    ("unsafe_order_routes", lambda record: record.update(orderRoutesEnabled=True)),
    ("sensitive_payload", lambda record: record["payload"].update(password=None)),
    ("missing_code", lambda record: record.update(code="")),
    ("invalid_receipt", lambda record: record.update(receivedAt="invalid")),
):
    record = copy.deepcopy(original)
    mutate(record)
    body = {key: value for key, value in record.items() if key != "recordHash"}
    record["recordHash"] = hashlib.sha256(
        (record["previousHash"] + "\n" + ledger_namespace["canonical"](body)).encode("utf-8")
    ).hexdigest()
    verify_hash(record)
    directory = OUT / name / "live-events"
    directory.mkdir(parents=True)
    target = directory / "2026-11-02.ndjson"
    target.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    manifest["cases"][name] = {
        "file": str(target), "recordHash": record["recordHash"],
        "wireSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "pythonRawHashVerified": True, "hostileSyntheticControl": True,
    }

# JSON numbers beyond IEEE-754 precision/range are adversarial raw-wire
# controls, not values emitted by Python's float encoder. Hash the exact sorted
# raw body lexemes independently before attaching the recordHash field.
original_body = {key: value for key, value in original.items() if key != "recordHash"}
original_canonical = ledger_namespace["canonical"](original_body)
for name, change in (
    ("precision_price", lambda body: body.replace('"bid_price":[10000.0,', '"bid_price":[10000.0000000000000001,')),
    ("precision_volume", lambda body: body.replace('"bid_volume":[10,', '"bid_volume":[10.0000000000000001,')),
    ("underflow_auxiliary", lambda body: body.replace('"payload":{', '"payload":{"SYNTHETIC_NONZERO_UNDERFLOW":1e-999,')),
    ("unsafe_integer_auxiliary", lambda body: body.replace('"payload":{', '"payload":{"SYNTHETIC_UNSAFE_INTEGER":9007199254740993,')),
    ("exact_unsafe_integer_auxiliary", lambda body: body.replace('"payload":{', '"payload":{"SYNTHETIC_UNSAFE_INTEGER":9007199254740992,')),
    ("overflow_auxiliary", lambda body: body.replace('"payload":{', '"payload":{"SYNTHETIC_OVERFLOW":1e999,')),
):
    canonical = change(original_canonical)
    assert canonical != original_canonical
    raw_hash = hashlib.sha256((original["previousHash"] + "\n" + canonical).encode("utf-8")).hexdigest()
    raw = canonical[:-1] + ',"recordHash":' + json.dumps(raw_hash) + '}\n'
    directory = OUT / name / "live-events"
    directory.mkdir(parents=True)
    target = directory / "2026-11-02.ndjson"
    target.write_text(raw, encoding="utf-8")
    manifest["cases"][name] = {
        "file": str(target), "recordHash": raw_hash,
        "wireSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "wireLexemeHashVerified": True, "hostileSyntheticControl": True,
    }

assert namespace["QUEUE_STATE"] == {"queued": len(cases), "dropped": 0}
manifest["bridgeSourceSha256"] = hashlib.sha256(bridge_source.encode("utf-8")).hexdigest()
manifest["ledgerSourceSha256"] = hashlib.sha256(ledger_source.encode("utf-8")).hexdigest()
print(json.dumps(manifest))
