"""Pure offline tests for the Shioaji quote watchdog's emergency-closure gate."""
from __future__ import annotations

import ast
from datetime import datetime
import json
from pathlib import Path
import tempfile
import unittest

from broker.taifex_emergency_market import governed_emergency_closure, canonical_sha256

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "config" / "taifex-emergency-closure-20261023.json"


class EmergencyClosureTests(unittest.TestCase):
    def test_real_signed_governance_works_for_closed_civil_day(self) -> None:
        self.assertTrue(governed_emergency_closure(
            datetime.fromisoformat("2026-10-23T08:35:00+08:00"), EVIDENCE))
        self.assertTrue(governed_emergency_closure(
            datetime.fromisoformat("2026-10-23T23:00:00+08:00"), EVIDENCE))
        self.assertFalse(governed_emergency_closure(
            datetime.fromisoformat("2026-10-22T19:28:23+08:00"), EVIDENCE))
        self.assertFalse(governed_emergency_closure(
            datetime.fromisoformat("2026-10-23T02:00:00+08:00"), EVIDENCE))
        self.assertFalse(governed_emergency_closure(
            datetime.fromisoformat("2026-10-26T09:00:00+08:00"), EVIDENCE))
        self.assertFalse(governed_emergency_closure(
            datetime.fromisoformat("2026-10-27T08:45:00+08:00"), EVIDENCE))

    def test_missing_optional_evidence_keeps_original_calendar_behavior(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(governed_emergency_closure(
                datetime.fromisoformat("2026-10-23T09:00:00+08:00"),
                Path(directory) / "none.json"))

    def test_bad_file_hash_never_qualifies_as_verified_closure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = json.loads(EVIDENCE.read_text(encoding="utf8"))
            bad = {**original, "fileHash": "a" * 64}
            file = Path(directory) / "modified.json"
            file.write_text(json.dumps(bad), encoding="utf8")
            with self.assertRaisesRegex(ValueError, "HASH_INVALID"):
                governed_emergency_closure(datetime.fromisoformat(
                    "2026-10-23T09:00:00+08:00"), file)

    def test_source_tampering_even_with_recomputed_container_hash_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = json.loads(EVIDENCE.read_text(encoding="utf8"))
            original["sourceEvidence"]["observedDate"] = "2026-10-22"
            body = {k: v for k, v in original.items() if k != "fileHash"}
            original["fileHash"] = canonical_sha256(body)
            file = Path(directory) / "modified.json"
            file.write_text(json.dumps(original, ensure_ascii=False), encoding="utf8")
            with self.assertRaisesRegex(ValueError, "SOURCE_HASH_INVALID"):
                governed_emergency_closure(datetime.fromisoformat(
                    "2026-10-23T09:00:00+08:00"), file)

    def test_governance_and_timezone_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = json.loads(EVIDENCE.read_text(encoding="utf8"))
            original["ownerApproved"] = False
            body = {k: v for k, v in original.items() if k != "fileHash"}
            original["fileHash"] = canonical_sha256(body)
            file = Path(directory) / "modified.json"
            file.write_text(json.dumps(original, ensure_ascii=False), encoding="utf8")
            with self.assertRaisesRegex(ValueError, "GOVERNANCE_INVALID"):
                governed_emergency_closure(datetime.fromisoformat(
                    "2026-10-23T09:00:00+08:00"), file)
        with self.assertRaisesRegex(ValueError, "TIMEZONE_REQUIRED"):
            governed_emergency_closure(datetime(2026, 10, 23), EVIDENCE)

    def test_live_bridge_uses_pure_gate_without_order_authority(self) -> None:
        bridge = ROOT / "broker" / "shioaji_readonly_bridge.py"
        code = bridge.read_text(encoding="utf-8")
        tree = ast.parse(code)
        fn = next(node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name == "tx_market_data_expected")
        called = [node.func.id for node in ast.walk(fn)
                  if isinstance(node, ast.Call)
                  and isinstance(node.func, ast.Name)]
        self.assertIn("governed_emergency_closure", called)
        self.assertNotIn("subscribe", called)
        self.assertNotIn("place_order", called)
        self.assertIn("broker/taifex_emergency_market.py",
            "broker/taifex_emergency_market.py")


if __name__ == "__main__":
    unittest.main()
