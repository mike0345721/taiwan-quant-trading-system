"""Default-off TXO live-chain selection for the existing read-only bridge.

This module contains no login, writer, order, or process lifecycle.  The formal
bridge remains the sole owner of the Shioaji session and append-only writer.
"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "txo-live-chain-activation-v1"
SELECTION_METHOD = "GOVERNED_NEAR_MARKET_LIQUID_PAIRS"
TAIPEI = timezone(timedelta(hours=8))


def _right(value: Any) -> str:
    raw = getattr(value, "value", value)
    text = str(raw or "").strip().upper()
    return "C" if text in {"C", "CALL"} else "P" if text in {"P", "PUT"} else ""


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_activation_config(enabled: bool, path: Path | None) -> dict[str, Any]:
    if not enabled:
        return {"enabled": False, "state": "STOPPED_EXPECTED"}
    if path is None or not path.is_file():
        raise RuntimeError("TXO_ACTIVATION_CONFIG_REQUIRED")
    payload = json.loads(path.read_text(encoding="utf-8"))
    required_false = ("executionAuthorized", "orderRoutesEnabled")
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("TXO_ACTIVATION_SCHEMA_INVALID")
    if payload.get("productionActivationApproved") is not True:
        raise RuntimeError("TXO_PRODUCTION_ACTIVATION_NOT_APPROVED")
    if payload.get("researchOnly") is not True or payload.get("formalWeight") != 0:
        raise RuntimeError("TXO_RESEARCH_BOUNDARY_INVALID")
    if any(payload.get(field) is not False for field in required_false):
        raise RuntimeError("TXO_EXECUTION_BOUNDARY_INVALID")
    approval_hash = str(payload.get("ownerApprovalHash") or "")
    if len(approval_hash) != 64 or any(char not in "0123456789abcdefABCDEF" for char in approval_hash):
        raise RuntimeError("TXO_OWNER_APPROVAL_HASH_INVALID")
    universe = payload.get("universe") or {}
    if universe.get("method") != SELECTION_METHOD or universe.get("sourceRoot") != "TXO":
        raise RuntimeError("TXO_UNIVERSE_METHOD_INVALID")
    if universe.get("expiryPolicy") != "NEAREST_MONTHLY":
        raise RuntimeError("TXO_EXPIRY_POLICY_INVALID")
    maximum = universe.get("ownerApprovedMaxContracts")
    if not isinstance(maximum, int) or maximum < 2 or maximum % 2:
        raise RuntimeError("TXO_OWNER_APPROVED_MAX_CONTRACTS_INVALID")
    return {**payload, "enabled": True, "state": "STARTING"}


def select_nearest_expiry_contracts(contracts: list[Any], as_of: date) -> list[Any]:
    eligible = [
        contract for contract in contracts
        if str(getattr(contract, "delivery_date", "") or "") >= as_of.isoformat()
        and (_number(getattr(contract, "strike_price", None)) or 0) > 0
        and _right(getattr(contract, "option_right", None))
    ]
    if not eligible:
        raise RuntimeError("TXO_NEAREST_EXPIRY_UNAVAILABLE")
    expiry = min(str(getattr(contract, "delivery_date", "") or "") for contract in eligible)
    return [contract for contract in eligible if str(getattr(contract, "delivery_date", "") or "") == expiry]


def _valid_two_sided(snapshot: Any) -> bool:
    bid = _number(getattr(snapshot, "buy_price", None))
    ask = _number(getattr(snapshot, "sell_price", None))
    return bid is not None and ask is not None and bid > 0 and ask >= bid


def select_governed_universe(
    contracts: list[Any], snapshots: list[Any], underlying_price: float, maximum_contracts: int
) -> list[Any]:
    if underlying_price <= 0 or maximum_contracts < 2 or maximum_contracts % 2:
        raise RuntimeError("TXO_SELECTION_INPUT_INVALID")
    snapshot_by_code = {
        str(getattr(snapshot, "code", "") or ""): snapshot for snapshot in snapshots
    }
    pairs: dict[float, dict[str, Any]] = {}
    for contract in contracts:
        strike = _number(getattr(contract, "strike_price", None))
        right = _right(getattr(contract, "option_right", None))
        code = str(getattr(contract, "code", "") or "")
        if strike is None or not right or not _valid_two_sided(snapshot_by_code.get(code)):
            continue
        pairs.setdefault(strike, {})[right] = contract
    selected: list[Any] = []
    for strike in sorted(pairs, key=lambda value: (abs(value - underlying_price), value)):
        pair = pairs[strike]
        if "C" not in pair or "P" not in pair:
            continue
        if len(selected) + 2 > maximum_contracts:
            break
        selected.extend((pair["C"], pair["P"]))
    if not selected:
        raise RuntimeError("TXO_TWO_SIDED_PAIR_UNAVAILABLE")
    return selected


def contract_metadata(contract: Any) -> dict[str, Any]:
    return {
        "sourceRoot": "TXO",
        "expiryClass": "MONTHLY",
        "expiry": str(getattr(contract, "delivery_date", "") or ""),
        "strike": _number(getattr(contract, "strike_price", None)),
        "callPut": _right(getattr(contract, "option_right", None)),
    }


def load_governed_calendar(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != "taifex-governed-trading-calendar-v1" or payload.get("ownerApproved") is not True:
        raise RuntimeError("TXO_GOVERNED_CALENDAR_INVALID")
    dates = sorted(str(value) for value in payload.get("tradingDates") or [])
    if not dates:
        raise RuntimeError("TXO_GOVERNED_CALENDAR_EMPTY")
    return {"tradingDates": dates, "sourceHash": payload.get("sourceHash"), "fileHash": payload.get("fileHash")}


def resolve_session_trade_date(event_time: datetime, calendar: dict[str, Any]) -> tuple[str, str]:
    local = event_time if event_time.tzinfo is None else event_time.astimezone(TAIPEI).replace(tzinfo=None)
    day = local.date().isoformat()
    clock = local.time()
    trading_dates = calendar["tradingDates"]
    if time(8, 45) <= clock < time(13, 45):
        if day not in trading_dates:
            raise RuntimeError("TXO_DAY_NOT_GOVERNED_TRADING_DATE")
        return "DAY", day
    if clock >= time(15, 0):
        later = [value for value in trading_dates if value > day]
        if not later:
            raise RuntimeError("TXO_NEXT_GOVERNED_TRADE_DATE_UNAVAILABLE")
        return "NIGHT", later[0]
    if clock < time(5, 0):
        if day not in trading_dates:
            raise RuntimeError("TXO_NIGHT_TRADE_DATE_NOT_GOVERNED")
        return "NIGHT", day
    raise RuntimeError("TXO_EVENT_OUTSIDE_GOVERNED_SESSION")
