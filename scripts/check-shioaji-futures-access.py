"""Verify read-only Shioaji futures access without exposing credentials or accounts.

This probe performs no order, cancel, certificate, position, or balance actions.
Its output is limited to capability flags and public contract identifiers.
"""

from __future__ import annotations

import argparse
import inspect
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

import shioaji as sj


ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_PATH = ROOT / ".shioaji.credentials.json"
CREDENTIAL_READER = ROOT / "scripts" / "read-shioaji-credentials.ps1"


def load_credentials(path: Path = CREDENTIAL_PATH) -> dict[str, Any]:
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
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    value = json.loads(result.stdout)
    if not value.get("apiKey") or not value.get("secretKey"):
        raise RuntimeError("DPAPI credentials are incomplete")
    return value


def enum_value(value: Any) -> str:
    raw = getattr(value, "value", value)
    return str(raw or "").strip().upper()


def account_is_futures(account: Any) -> bool:
    account_type = enum_value(getattr(account, "account_type", None))
    class_name = type(account).__name__.upper()
    return account_type in {"F", "FUTURES", "FUTURE"} or "FUTURE" in class_name


def account_is_signed(account: Any) -> bool:
    return bool(getattr(account, "signed", False))


def contract_summary(contract: Any) -> dict[str, Any]:
    if contract is None:
        return {"visible": False}
    return {
        "visible": True,
        "code": str(getattr(contract, "code", "") or ""),
        "symbol": str(getattr(contract, "symbol", "") or ""),
        "targetCode": str(getattr(contract, "target_code", "") or ""),
        "deliveryMonth": str(getattr(contract, "delivery_month", "") or ""),
    }

def option_contract_summary(contract: Any) -> dict[str, Any]:
    return {
        "code": str(getattr(contract, "code", "") or ""),
        "symbol": str(getattr(contract, "symbol", "") or ""),
        "deliveryDate": str(getattr(contract, "delivery_date", "") or ""),
        "deliveryMonth": str(getattr(contract, "delivery_month", "") or ""),
        "strikePrice": float(getattr(contract, "strike_price", 0) or 0),
        "optionRight": enum_value(getattr(contract, "option_right", None)),
        "underlyingKind": str(getattr(contract, "underlying_kind", "") or ""),
    }


def find_contract(contracts: Any, aliases: tuple[str, ...]) -> Any:
    for alias in aliases:
        contract = contracts.get(alias)
        if contract is not None:
            return contract
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--production-readonly",
        action="store_true",
        help="verify the production account without enabling order routes",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="write the sanitized result to a JSON evidence file",
    )
    parser.add_argument(
        "--credential-path",
        type=Path,
        default=CREDENTIAL_PATH,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()
    previous_result: dict[str, Any] = {}
    if args.output and args.output.exists():
        try:
            previous_result = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous_result = {}
    result: dict[str, Any] = {
        "schemaVersion": "1.0.0",
        "provider": "shioaji",
        "mode": "market_data_only",
        "checkedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        # Immutable live-capture markers must never be replaced by a later
        # access probe. They are maintained by the live acceptance workflow.
        "liveEvidenceNotBefore": previous_result.get("liveEvidenceNotBefore"),
        "login": False,
        "futuresAccountVisible": False,
        "futuresApiSigned": False,
        "accountCapabilities": [],
        "contracts": {},
        "snapshots": {},
        "optionsAccess": {
            "txoGroupVisible": False,
            "contractCount": 0,
            "expirySummaries": [],
            "txOptionRoots": [],
            "snapshotFields": [],
            "providerGreeksFields": [],
            "sampleContracts": [],
            "boundedQuoteProbe": {
                "futurePrice": None,
                "expiry": None,
                "contracts": [],
            },
            "contractApiMethods": [],
            "optionsSignature": "",
        },
        "executionAuthorized": False,
        "orderRoutesEnabled": False,
    }
    credentials = load_credentials(args.credential_path)
    simulation = (
        False
        if args.production_readonly
        else not bool(credentials.get("production", False))
    )
    result["simulation"] = simulation
    api = sj.Shioaji(simulation=simulation)
    logged_in = False
    try:
        accounts = api.login(
            api_key=str(credentials["apiKey"]),
            secret_key=str(credentials["secretKey"]),
            subscribe_trade=False,
        )
        logged_in = True
        result["login"] = True
        if accounts is None:
            accounts = api.list_accounts()
        result["accountCapabilities"] = [
            {
                "class": type(account).__name__,
                "type": enum_value(getattr(account, "account_type", None)),
                "signed": account_is_signed(account),
            }
            for account in (accounts or [])
        ]
        futures_accounts = [
            account for account in (accounts or []) if account_is_futures(account)
        ]
        result["futuresAccountVisible"] = bool(futures_accounts)
        result["futuresApiSigned"] = any(
            account_is_signed(account) for account in futures_accounts
        )

        contracts = api.contracts
        result["optionsAccess"]["contractApiMethods"] = sorted(
            name for name in dir(contracts) if not name.startswith("_")
        )
        result["optionsAccess"]["optionsSignature"] = str(
            inspect.signature(contracts.options)
        )
        option_roots_value = contracts.option_roots()
        option_roots = sorted(str(root) for root in (option_roots_value or []))
        tx_option_roots = [root for root in option_roots if root.startswith("TX")]
        for option_root in tx_option_roots:
            try:
                root_contracts = list(contracts.options(option_root))
            except (AttributeError, TypeError):
                continue
            dates = sorted({
                str(getattr(item, "delivery_date", "") or "")
                for item in root_contracts
                if str(getattr(item, "delivery_date", "") or "")
            })
            result["optionsAccess"]["txOptionRoots"].append({
                "root": option_root,
                "contractCount": len(root_contracts),
                "deliveryDates": dates,
            })
        contract_refs = {
            "TX": find_contract(contracts, ("TXFR1", "TXF")),
            "MTX": find_contract(contracts, ("MXFR1", "MXF", "MTX")),
            "TMF": find_contract(contracts, ("TMFR1", "TMF")),
            "TXO": find_contract(contracts, ("TXO",)),
        }
        result["contracts"] = {
            code: contract_summary(contract)
            for code, contract in contract_refs.items()
        }
        snapshot_contracts = [
            contract_refs[code]
            for code in ("TX", "MTX", "TMF")
            if contract_refs[code] is not None
        ]
        snapshots = api.snapshots(snapshot_contracts)
        tx_snapshot = next(
            (
                snapshot
                for snapshot in snapshots
                if str(getattr(snapshot, "code", "") or "") == "TXFR1"
            ),
            snapshots[0] if snapshots else None,
        )
        future_price = (
            float(getattr(tx_snapshot, "close", 0) or 0)
            if tx_snapshot is not None
            else 0
        )
        result["snapshots"] = {
            str(getattr(snapshot, "code", "") or ""): {
                "received": True,
                "timestampPresent": getattr(snapshot, "ts", None) is not None,
                "closePresent": getattr(snapshot, "close", None) is not None,
                "totalVolume": int(getattr(snapshot, "total_volume", 0) or 0),
            }
            for snapshot in snapshots
        }
        try:
            txo_contracts = list(contracts.options("TXO"))
            result["optionsAccess"]["txoGroupVisible"] = True
            result["optionsAccess"]["contractCount"] = len(txo_contracts)
            if txo_contracts:
                expiry_groups: dict[tuple[str, str], list[Any]] = {}
                for option_contract in txo_contracts:
                    key = (
                        str(getattr(option_contract, "delivery_date", "") or ""),
                        str(getattr(option_contract, "delivery_month", "") or ""),
                    )
                    expiry_groups.setdefault(key, []).append(option_contract)
                expiry_summaries = []
                for (delivery_date, delivery_month), group in sorted(expiry_groups.items()):
                    strikes = sorted({
                        float(getattr(item, "strike_price", 0) or 0)
                        for item in group
                        if float(getattr(item, "strike_price", 0) or 0) > 0
                    })
                    rights = [enum_value(getattr(item, "option_right", None)) for item in group]
                    expiry_summaries.append({
                        "deliveryDate": delivery_date,
                        "deliveryMonth": delivery_month,
                        "contractCount": len(group),
                        "callCount": sum(right in {"C", "CALL"} for right in rights),
                        "putCount": sum(right in {"P", "PUT"} for right in rights),
                        "strikeCount": len(strikes),
                        "minStrike": strikes[0] if strikes else None,
                        "maxStrike": strikes[-1] if strikes else None,
                    })
                result["optionsAccess"]["expirySummaries"] = expiry_summaries
                result["optionsAccess"]["sampleContracts"] = [
                    option_contract_summary(contract)
                    for contract in sorted(
                        txo_contracts,
                        key=lambda item: (
                            str(getattr(item, "delivery_date", "") or ""),
                            float(getattr(item, "strike_price", 0) or 0),
                            enum_value(getattr(item, "option_right", None)),
                        ),
                    )[:6]
                ]
                option_snapshot = api.snapshots([txo_contracts[0]])[0]
                snapshot_payload = (
                    option_snapshot.dict()
                    if hasattr(option_snapshot, "dict")
                    else vars(option_snapshot)
                )
                snapshot_fields = sorted(str(key) for key in snapshot_payload)
                greek_names = {
                    "iv",
                    "implied_volatility",
                    "delta",
                    "gamma",
                    "theta",
                    "vega",
                }
                result["optionsAccess"]["snapshotFields"] = snapshot_fields
                result["optionsAccess"]["providerGreeksFields"] = [
                    field for field in snapshot_fields if field.lower() in greek_names
                ]
                dated_contracts = [
                    contract
                    for contract in txo_contracts
                    if str(getattr(contract, "delivery_date", "") or "")
                    >= datetime.now().date().isoformat()
                    and float(getattr(contract, "strike_price", 0) or 0) > 0
                ]
                if dated_contracts and future_price > 0:
                    expiry = min(
                        str(getattr(contract, "delivery_date", "") or "")
                        for contract in dated_contracts
                    )
                    expiry_contracts = [
                        contract
                        for contract in dated_contracts
                        if str(getattr(contract, "delivery_date", "") or "") == expiry
                    ]
                    strikes = sorted(
                        {
                            float(getattr(contract, "strike_price", 0) or 0)
                            for contract in expiry_contracts
                        },
                        key=lambda strike: (abs(strike - future_price), strike),
                    )[:5]
                    selected_options = [
                        contract
                        for contract in expiry_contracts
                        if float(getattr(contract, "strike_price", 0) or 0) in strikes
                    ][:10]
                    option_snapshots = {
                        str(getattr(snapshot, "code", "") or ""): snapshot
                        for snapshot in api.snapshots(selected_options)
                    }
                    bounded_contracts = []
                    for contract in selected_options:
                        summary = option_contract_summary(contract)
                        snapshot = option_snapshots.get(summary["code"])
                        bid = float(getattr(snapshot, "buy_price", 0) or 0) if snapshot else 0
                        ask = float(getattr(snapshot, "sell_price", 0) or 0) if snapshot else 0
                        summary.update(
                            {
                                "bid": bid or None,
                                "ask": ask or None,
                                "close": (
                                    float(getattr(snapshot, "close", 0) or 0) or None
                                    if snapshot
                                    else None
                                ),
                                "timestamp": (
                                    int(getattr(snapshot, "ts", 0) or 0) or None
                                    if snapshot
                                    else None
                                ),
                                "validTwoSidedQuote": bid > 0 and ask >= bid,
                            }
                        )
                        bounded_contracts.append(summary)
                    result["optionsAccess"]["boundedQuoteProbe"] = {
                        "futurePrice": future_price,
                        "expiry": expiry,
                        "contracts": bounded_contracts,
                    }
        except (AttributeError, IndexError, TypeError):
            pass
    finally:
        if logged_in:
            api.logout()

    market_data_ready = (
        result["login"]
        and result["futuresAccountVisible"]
        and all(result["contracts"][code]["visible"] for code in ("TX", "MTX", "TMF"))
        and len(result["snapshots"]) == 3
    )
    result["readyForFuturesMarketDataValidation"] = market_data_ready
    result["readyForProductionTrading"] = (
        market_data_ready and result["futuresApiSigned"]
    )
    if args.output:
        output_path = args.output
        if not output_path.is_absolute():
            output_path = ROOT / output_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
