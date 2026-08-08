"""Append-only, hash-chained storage for read-only market-data events."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any


def canonical(value: dict[str, Any]) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


class LiveEventLedger:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.previous_hash = "GENESIS"
        self.current_file: Path | None = None
        self.recent_ids: deque[str] = deque(maxlen=20_000)
        self.recent_id_set: set[str] = set()
        self.last_sequence: dict[str, int] = {}
        self.events_written = 0
        self.duplicates = 0
        self.sequence_gaps = 0
        self.clock_skew_events = 0
        self.latest_received_at: str | None = None

    def _rotate(self, received: datetime) -> Path:
        target = self.directory / f"{received.date().isoformat()}.ndjson"
        if target == self.current_file:
            return target
        self.current_file = target
        self.previous_hash = "GENESIS"
        if target.exists():
            lines = target.read_text(encoding="utf-8").splitlines()
            if lines:
                self.previous_hash = str(json.loads(lines[-1]).get("recordHash") or "GENESIS")
        return target

    def _remember(self, event_id: str) -> bool:
        duplicate = event_id in self.recent_id_set
        if duplicate:
            return True
        if len(self.recent_ids) == self.recent_ids.maxlen:
            self.recent_id_set.discard(self.recent_ids[0])
        self.recent_ids.append(event_id)
        self.recent_id_set.add(event_id)
        return False

    def append(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        received = datetime.now().astimezone()
        received_at = received.isoformat()
        target = self._rotate(received)
        code = str(payload.get("code") or payload.get("Code") or kind)
        sequence_raw = payload.get("sequence") or payload.get("seq") or payload.get("tick_sn")
        sequence = int(sequence_raw) if isinstance(sequence_raw, (int, float)) else None
        exchange_raw = payload.get("datetime") or payload.get("timestamp") or payload.get("ts")
        exchange_timestamp = str(exchange_raw) if exchange_raw is not None else None
        event_identity = canonical({
            "kind": kind, "code": code, "sequence": sequence,
            "exchangeTimestamp": exchange_timestamp, "payload": payload,
        })
        event_id = hashlib.sha256(event_identity.encode("utf-8")).hexdigest()
        duplicate = self._remember(event_id)
        sequence_gap = 0
        if sequence is not None:
            prior = self.last_sequence.get(code)
            if prior is not None and sequence > prior + 1:
                sequence_gap = sequence - prior - 1
            self.last_sequence[code] = max(sequence, prior or sequence)
        clock_skew_ms = None
        if exchange_timestamp:
            try:
                exchange_time = datetime.fromisoformat(exchange_timestamp.replace("Z", "+00:00"))
                if exchange_time.tzinfo is None:
                    exchange_time = exchange_time.replace(tzinfo=received.tzinfo)
                clock_skew_ms = int((received - exchange_time).total_seconds() * 1000)
            except (TypeError, ValueError):
                pass
        body = {
            "schemaVersion": "1.0.0",
            "provider": "shioaji",
            "kind": kind,
            "code": code,
            "product": code,
            "receivedAt": received_at,
            "exchangeTimestamp": exchange_timestamp,
            "sequence": sequence,
            "eventId": event_id,
            "duplicate": duplicate,
            "sequenceGap": sequence_gap,
            "clockSkewMs": clock_skew_ms,
            "executionAuthorized": False,
            "orderRoutesEnabled": False,
            "payload": payload,
            "previousHash": self.previous_hash,
        }
        record_hash = hashlib.sha256(
            f"{self.previous_hash}\n{canonical(body)}".encode("utf-8")
        ).hexdigest()
        record = {**body, "recordHash": record_hash}
        encoded = (
            json.dumps(record, ensure_ascii=False, separators=(",", ":"), default=str) + "\n"
        ).encode("utf-8")
        descriptor = os.open(target, os.O_APPEND | os.O_CREAT | os.O_WRONLY)
        try:
            os.write(descriptor, encoded)
        finally:
            os.close(descriptor)
        self.previous_hash = record_hash
        self.events_written += 1
        self.duplicates += int(duplicate)
        self.sequence_gaps += sequence_gap
        self.clock_skew_events += int(clock_skew_ms is not None and abs(clock_skew_ms) > 5_000)
        self.latest_received_at = received_at
        return record

    def health(self) -> dict[str, Any]:
        usage = shutil.disk_usage(self.directory)
        return {
            "eventStorage": "append_only_hash_chain",
            "eventsWritten": self.events_written,
            "duplicateEvents": self.duplicates,
            "sequenceGaps": self.sequence_gaps,
            "clockSkewEvents": self.clock_skew_events,
            "latestReceivedAt": self.latest_received_at,
            "freeBytes": usage.free,
            "lowDisk": usage.free < 2 * 1024 * 1024 * 1024,
            "executionAuthorized": False,
        }
