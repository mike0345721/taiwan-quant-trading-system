"""Fetch an isolated Shioaji TXFR1 K-bar candidate set for overlap validation.

This script has no order, certificate, account, position, or balance routes.
It never writes into the formal TAIFEX replay archive.
"""

from __future__ import annotations

import json
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import shioaji as sj


ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL_PATH = ROOT / ".shioaji.credentials.json"
CREDENTIAL_READER = ROOT / "scripts" / "read-shioaji-credentials.ps1"
STATUS_PATH = ROOT / "data" / "intraday" / "taifex-backfill-status.json"
OUTPUT_PATH = (
    ROOT
    / "data"
    / "intraday"
    / "candidates"
    / "shioaji-kbars-29d"
    / "raw.json"
)
TAIPEI = timezone(timedelta(hours=8), name="Asia/Taipei")


def load_credentials() -> dict[str, Any]:
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(CREDENTIAL_READER),
            "-Path",
            str(CREDENTIAL_PATH),
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


def scalar(value: Any) -> Any:
    return value.item() if hasattr(value, "item") else value


def local_timestamp(value: Any) -> str:
    nanoseconds = int(scalar(value))
    # Shioaji historical ts values encode Taiwan wall-clock fields.  Converting
    # them as a normal UTC epoch and then applying +08:00 shifts them twice.
    wall_clock = datetime.fromtimestamp(
        nanoseconds / 1_000_000_000, timezone.utc
    ).replace(tzinfo=TAIPEI)
    return wall_clock.isoformat(timespec="seconds")


def contract_metadata(contract: Any) -> dict[str, Any]:
    fields = ("code", "symbol", "name", "category", "delivery_month")
    return {
        field: scalar(getattr(contract, field, None))
        for field in fields
        if getattr(contract, field, None) is not None
    }


def main() -> None:
    status = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    target_dates = sorted(
        item["TradeDate"]
        for item in status.get("results", [])
        if item.get("State") in {"verified_existing", "verified_downloaded"}
    )
    if len(target_dates) != 29:
        raise RuntimeError(f"expected 29 overlap dates, found {len(target_dates)}")

    credentials = load_credentials()
    simulation = not bool(credentials.get("production", False))
    api = sj.Shioaji(simulation=simulation)
    logged_in = False
    rows: list[dict[str, Any]] = []
    contract: Any = None
    try:
        api.login(
            api_key=str(credentials["apiKey"]),
            secret_key=str(credentials["secretKey"]),
        )
        logged_in = True
        contract = api.contracts.get("TXFR1")
        if contract is None:
            raise LookupError("continuous futures contract not found: TXFR1")

        # Fetch one date per request.  Long requests can hit the provider row
        # cap and silently return incomplete session coverage.
        for target_date in target_dates:
            values = api.kbars(
                contract,
                start=target_date,
                end=target_date,
            )
            keys = ("ts", "Open", "High", "Low", "Close", "Volume", "Amount")
            available = {key: getattr(values, key, []) for key in keys}
            count = len(available["ts"])
            for index in range(count):
                timestamp = local_timestamp(available["ts"][index])
                local = datetime.fromisoformat(timestamp)
                trade_date = local.date().isoformat()
                # Shioaji one-minute K-bars are right-labelled [ts-1m, ts).
                if (
                    trade_date not in target_dates
                    or not (local.hour > 8 or (local.hour == 8 and local.minute > 45))
                    or (local.hour > 13 or (local.hour == 13 and local.minute > 45))
                ):
                    continue
                rows.append(
                    {
                        "timestamp": timestamp,
                        "tradeDate": trade_date,
                        "open": float(scalar(available["Open"][index])),
                        "high": float(scalar(available["High"][index])),
                        "low": float(scalar(available["Low"][index])),
                        "close": float(scalar(available["Close"][index])),
                        "volume": float(scalar(available["Volume"][index])),
                        "amount": (
                            float(scalar(available["Amount"][index]))
                            if len(available["Amount"]) > index
                            else None
                        ),
                    }
                )
    finally:
        if logged_in:
            api.logout()

    unique = {(row["timestamp"], row["tradeDate"]): row for row in rows}
    output = {
        "schemaVersion": "1.0.0",
        "source": "Shioaji historical K-bars",
        "candidateOnly": True,
        "formalArchiveModified": False,
        "executionAuthorized": False,
        "requestedContract": "TXFR1",
        "contractMetadata": contract_metadata(contract) if contract is not None else {},
        "timestampConvention": "Asia/Taipei right-labelled one-minute [ts-1m, ts)",
        "targetDates": target_dates,
        "retrievedAt": datetime.now(TAIPEI).isoformat(timespec="seconds"),
        "simulationLogin": simulation,
        "rowCount": len(unique),
        "rows": sorted(unique.values(), key=lambda row: row["timestamp"]),
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "output": str(OUTPUT_PATH),
                "targetDates": len(target_dates),
                "rows": len(unique),
                "executionAuthorized": False,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
