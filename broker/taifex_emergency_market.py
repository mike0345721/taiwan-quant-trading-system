"""Read-only TAIFEX emergency-closure gate for Shioaji's quote watchdog.

Uses the same hash-authorized exception artifact as the JS calendar; it never
logs in, subscribes, accesses credentials, or changes event-ledger records.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

TAIPEI = timezone(timedelta(hours=8))
MAX_EVIDENCE_BYTES = 64 * 1024
REQUIRED_DATE_SOURCE = "TAIFEX_OFFICIAL_EXCEPTION_EVIDENCE"
REQUIRED_SCHEMA = "taifex-official-calendar-exception-v1"


def canonical_sha256(document: Any) -> str:
    """Equivalent to the JS governed-calendar digest for this JSON schema."""
    serialized = json.dumps(
        document, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def governed_emergency_closure(now: datetime, evidence_path: Path) -> bool:
    """Return true only with fully verified market-closure evidence.

    Missing optional evidence means preserve the existing trading-day behavior.
    Invalid present evidence must fail closed, never silently enable recovery.
    The 00:00–04:59 period belongs to the preceding night's session and must
    not be erased solely because the new civil date has an emergency closure.
    """
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise ValueError("TAIFEX_MARKET_TIMEZONE_REQUIRED")
    evidence_path = Path(evidence_path)
    if not evidence_path.is_file():
        return False
    if evidence_path.stat().st_size > MAX_EVIDENCE_BYTES:
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_SIZE_INVALID")
    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_UNREADABLE") from exc
    if not isinstance(evidence, dict):
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_SCHEMA_INVALID")
    if (
        evidence.get("schemaVersion") != REQUIRED_SCHEMA
        or evidence.get("sourceType") != REQUIRED_DATE_SOURCE
        or evidence.get("ownerApproved") is not True
        or evidence.get("approvalScope") != "ISOLATED_RESEARCH_CANDIDATE_ONLY"
        or evidence.get("formalWeight") != 0
        or evidence.get("researchOnly") is not True
        or evidence.get("executionAuthorized") is not False
        or evidence.get("orderRoutesEnabled") is not False
    ):
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_GOVERNANCE_INVALID")
    content = dict(evidence)
    claimed_file_hash = content.pop("fileHash", None)
    if canonical_sha256(content) != claimed_file_hash:
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_HASH_INVALID")
    source = evidence.get("sourceEvidence")
    if not isinstance(source, dict) or canonical_sha256(source) != evidence.get("sourceHash"):
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_SOURCE_HASH_INVALID")
    notices = source.get("publicNotices", [])
    if not isinstance(notices, list) or len(notices) < 1 or any(
        not isinstance(x, dict) or not str(x.get("url", "")).startswith("https://")
        for x in notices
    ):
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_NOTICES_INVALID")
    exceptions = evidence.get("exceptions")
    if not isinstance(exceptions, list) or not exceptions:
        raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_DATES_INVALID")
    today = now.astimezone(TAIPEI)
    for item in exceptions:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("tradeDate"), str)
            or item.get("officialTradingDay") is not False
            or item.get("closedCivilDate") is not True
            or item.get("reason") != "OFFICIAL_TYPHOON_EMERGENCY_CLOSURE"
        ):
            raise ValueError("TAIFEX_EMERGENCY_EVIDENCE_EXCEPTION_INVALID")
    if today.time() < time(5, 0):
        return False
    return any(item["tradeDate"] == today.date().isoformat() for item in exceptions)


def market_data_expected(now: datetime, calendar_path: Path, evidence_path: Path,
                         *, allow_candidate: bool = False) -> bool:
    """Operating civil-day clock; never use event trade-date mapping for recovery."""
    if now.tzinfo is None:
        raise ValueError("TAIFEX_MARKET_TIMEZONE_REQUIRED")
    calendar = json.loads(Path(calendar_path).read_text(encoding="utf-8-sig"))
    body = {k: v for k, v in calendar.items() if k != "fileHash"}
    if (calendar.get("ownerApproved") is not True
            or calendar.get("schemaVersion") != "taifex-governed-trading-calendar-v1"
            or canonical_sha256(body) != calendar.get("fileHash")):
        raise ValueError("TAIFEX_OPERATING_CALENDAR_INVALID")
    local = now.astimezone(TAIPEI)
    anchor = local - timedelta(days=1) if local.time() < time(5) else local
    exceptions = {}
    pending = set()
    formal_path = Path(calendar_path).parent.parent / "data/market-state/forward-shadow/governance/taifex-official-calendar-exception.json"
    for source_path in dict.fromkeys([formal_path, Path(evidence_path)]):
        if not source_path.exists():
            continue
        if source_path.stat().st_size > MAX_EVIDENCE_BYTES:
            raise ValueError("TAIFEX_OPERATING_EXCEPTION_OVERSIZE")
        evidence = json.loads(source_path.read_text(encoding="utf-8-sig"))
        source_hash = evidence.get("sourceHash", "")
        if (evidence.get("schemaVersion") != REQUIRED_SCHEMA
                or evidence.get("sourceType") != REQUIRED_DATE_SOURCE
                or evidence.get("ownerApproved") is not True
                or not isinstance(source_hash, str) or len(source_hash) != 64
                or any(c not in "0123456789abcdef" for c in source_hash)
                or canonical_sha256({k: v for k, v in evidence.items() if k != "fileHash"}) != evidence.get("fileHash")
                or (evidence.get("sourceEvidence") is not None and canonical_sha256(evidence["sourceEvidence"]) != source_hash)
                or not isinstance(evidence.get("exceptions"), list)):
            raise ValueError("TAIFEX_OPERATING_EXCEPTION_INVALID")
        candidate = evidence.get("approvalScope") == "ISOLATED_RESEARCH_CANDIDATE_ONLY"
        if candidate and (evidence.get("formalWeight") != 0 or evidence.get("researchOnly") is not True
                or evidence.get("executionAuthorized") is not False or evidence.get("orderRoutesEnabled") is not False):
            raise ValueError("TAIFEX_OPERATING_EXCEPTION_SAFETY_INVALID")
        seen = set()
        for item in evidence["exceptions"]:
            day = item.get("tradeDate") if isinstance(item, dict) else None
            if (day not in calendar["tradingDates"] + calendar["nonTradingDates"] or day in seen
                    or type(item.get("officialTradingDay")) is not bool):
                raise ValueError("TAIFEX_OPERATING_EXCEPTION_DATE_INVALID")
            seen.add(day)
            if candidate and not allow_candidate:
                pending.add(day)
                continue
            entry = {**item, "evidenceFileHash": evidence["fileHash"]}
            if day in exceptions and exceptions[day] != entry:
                raise ValueError("OPERATING_CALENDAR_EXCEPTION_CONFLICT")
            exceptions[day] = entry
    if pending.intersection({local.date().isoformat(), anchor.date().isoformat()}):
        raise ValueError("TAIFEX_CANDIDATE_NOT_ACTIVATED")
    anchor_date = anchor.date().isoformat()
    if not all(calendar["coverageStart"] <= day <= calendar["coverageEnd"]
               for day in (local.date().isoformat(), anchor_date)):
        raise ValueError("TAIFEX_OPERATING_DATE_UNCOVERED")
    trading = exceptions.get(anchor_date, {}).get("officialTradingDay", anchor_date in calendar["tradingDates"])
    if not trading:
        return False
    return local.time() < time(5) or time(8, 45) <= local.time() < time(13, 45) or local.time() >= time(15)
