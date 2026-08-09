"""Pure helpers for Market State forward collection.

This module contains no login, order, position, balance, or certificate logic.
It only validates collection configuration and selects a bounded research basket.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any, Iterable


DEFAULT_CONFIG = {
    "enabled": False,
    "leadership": {"enabled": False, "codes": []},
    "options": {
        "enabled": False,
        "root": "TXO",
        "expiryCount": 2,
        "strikesPerSide": 8,
    },
}
COLLECTOR_SUBSCRIPTION_SAFETY_CAP = 160


def load_market_state_collection_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return DEFAULT_CONFIG.copy()
    raw = json.loads(path.read_text(encoding="utf-8"))
    config = {
        "enabled": bool(raw.get("enabled", False)),
        "leadership": {
            "enabled": bool(raw.get("leadership", {}).get("enabled", False)),
            "codes": [
                str(code).strip()
                for code in raw.get("leadership", {}).get("codes", [])
                if str(code).strip()
            ],
        },
        "options": {
            "enabled": bool(raw.get("options", {}).get("enabled", False)),
            "root": str(raw.get("options", {}).get("root", "TXO")).strip() or "TXO",
            "expiryCount": max(1, min(3, int(raw.get("options", {}).get("expiryCount", 2)))),
            "strikesPerSide": max(2, min(15, int(raw.get("options", {}).get("strikesPerSide", 8)))),
        },
    }
    if len(config["leadership"]["codes"]) > 30:
        raise ValueError("market_state_leadership_codes_exceed_30")
    planned = 0
    if config["leadership"]["enabled"]:
        planned += len(config["leadership"]["codes"])
    if config["options"]["enabled"]:
        planned += (
            config["options"]["expiryCount"]
            * (2 * config["options"]["strikesPerSide"] + 1)
            * 2
        )
    if planned > COLLECTOR_SUBSCRIPTION_SAFETY_CAP:
        raise ValueError(f"market_state_planned_subscriptions_exceed_{COLLECTOR_SUBSCRIPTION_SAFETY_CAP}:{planned}")
    config["plannedSubscriptionUpperBound"] = planned
    return config


def _value(info: Any, name: str, default: Any = None) -> Any:
    if isinstance(info, dict):
        return info.get(name, default)
    return getattr(info, name, default)


def _iso_day(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    text = str(value)
    return text[:10] if len(text) >= 10 else text


def select_txo_contracts(
    option_infos: Iterable[Any],
    *,
    underlying_price: float,
    today: date,
    expiry_count: int = 2,
    strikes_per_side: int = 8,
) -> list[dict[str, Any]]:
    """Select a bounded pair-complete TXO surface around the underlying.

    Selection is deterministic and research-only. For each of the nearest eligible
    expiry dates, choose the closest (2*strikes_per_side+1) strikes and retain both
    Call and Put when present. No delta estimate is used at collection time.
    """
    if not isinstance(underlying_price, (int, float)) or underlying_price <= 0:
        return []
    rows: list[dict[str, Any]] = []
    for info in option_infos:
        code = str(_value(info, "code", "") or "")
        strike_raw = _value(info, "strike_price")
        right_raw = _value(info, "option_right")
        expiry = _iso_day(_value(info, "delivery_date") or _value(info, "last_trading_date"))
        try:
            strike = float(strike_raw)
        except (TypeError, ValueError):
            continue
        right = getattr(right_raw, "value", right_raw)
        right = str(right or "").upper()[:1]
        if not code or strike <= 0 or right not in {"C", "P"} or not expiry:
            continue
        if expiry < today.isoformat():
            continue
        rows.append({
            "code": code,
            "strikePrice": strike,
            "optionRight": right,
            "deliveryDate": expiry,
            "deliveryMonth": str(_value(info, "delivery_month", "") or ""),
            "underlyingCode": str(_value(info, "underlying_code", "IX0001") or "IX0001"),
        })

    expiries = sorted({row["deliveryDate"] for row in rows})[: max(1, expiry_count)]
    selected: list[dict[str, Any]] = []
    strike_count = 2 * max(1, strikes_per_side) + 1
    for expiry in expiries:
        expiry_rows = [row for row in rows if row["deliveryDate"] == expiry]
        strikes = sorted(
            {row["strikePrice"] for row in expiry_rows},
            key=lambda strike: (abs(strike - underlying_price), strike),
        )[:strike_count]
        strike_set = set(strikes)
        selected.extend(
            sorted(
                (row for row in expiry_rows if row["strikePrice"] in strike_set),
                key=lambda row: (row["strikePrice"], row["optionRight"], row["code"]),
            )
        )
    return selected
