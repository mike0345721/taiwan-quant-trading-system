"""Pure offline tests for the Shioaji quote watchdog's emergency-closure gate."""
from __future__ import annotations

import ast
from datetime import datetime
import json
from pathlib import Path
import tempfile
import unittest
from typing import Any, Mapping

from broker.taifex_emergency_market import governed_emergency_closure, canonical_sha256, market_data_expected

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
        self.assertIn("market_data_expected", called)
        self.assertNotIn("subscribe", called)
        self.assertNotIn("place_order", called)
        self.assertIn("broker/taifex_emergency_market.py",
            "broker/taifex_emergency_market.py")

    def test_operating_clock_matches_js_without_changing_event_mapping(self) -> None:
        calendar = ROOT / "config" / "taifex-official-calendar-2026.json"
        for text, expected in [
            ("2026-10-22T19:00:00+08:00", True),
            ("2026-10-23T04:59:59+08:00", True),
            ("2026-10-23T05:00:00+08:00", False),
            ("2026-10-24T16:00:00+08:00", False),
            ("2026-10-26T16:00:00+08:00", False),
            ("2026-10-27T02:00:00+08:00", False),
            ("2026-10-27T08:45:00+08:00", True),
        ]:
            self.assertEqual(market_data_expected(datetime.fromisoformat(text), calendar,
                EVIDENCE, allow_candidate=True), expected, text)
        with self.assertRaisesRegex(ValueError, "CANDIDATE_NOT_ACTIVATED"):
            market_data_expected(datetime.fromisoformat("2026-10-23T09:00:00+08:00"), calendar, EVIDENCE)

    def test_formal_operating_exception_and_login_gate(self) -> None:
        import shutil
        import sys
        with self.assertRaisesRegex(ValueError, "DATE_UNCOVERED"):
            market_data_expected(datetime.fromisoformat("2027-01-01T02:00:00+08:00"),
                ROOT / "config/taifex-official-calendar-2026.json", EVIDENCE, allow_candidate=True)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "config").mkdir()
            calendar = root / "config/taifex-official-calendar-2026.json"
            shutil.copyfile(ROOT / "config/taifex-official-calendar-2026.json", calendar)
            formal = root / "data/market-state/forward-shadow/governance/taifex-official-calendar-exception.json"
            formal.parent.mkdir(parents=True)
            evidence = {"schemaVersion": "taifex-official-calendar-exception-v1", "sourceType": "TAIFEX_OFFICIAL_EXCEPTION_EVIDENCE",
                "ownerApproved": True, "sourceHash": "a" * 64,
                "exceptions": [{"tradeDate": "2026-10-27", "officialTradingDay": False, "reason": "TEST_ONLY"}]}
            evidence["fileHash"] = canonical_sha256(evidence)
            formal.write_text(json.dumps(evidence), encoding="utf-8")
            self.assertFalse(market_data_expected(datetime.fromisoformat("2026-10-27T09:00:00+08:00"), calendar, EVIDENCE))
            evidence["exceptions"][0]["officialTradingDay"] = True
            formal.write_text(json.dumps(evidence), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "INVALID"):
                market_data_expected(datetime.fromisoformat("2026-10-27T09:00:00+08:00"), calendar, EVIDENCE)
        tree = ast.parse((ROOT / "broker/shioaji_readonly_bridge.py").read_text(encoding="utf-8"))
        gate = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "require_open_operating_session")
        scope = {"tx_market_data_expected": lambda: False, "sys": sys}
        exec(compile(ast.Module(body=[gate], type_ignores=[]), "offline_gate", "exec"), scope)
        with self.assertRaises(SystemExit) as ctx:
            scope["require_open_operating_session"]()
        self.assertEqual(ctx.exception.code, 76)
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
        for statements in [main.body] + [n.body for n in ast.walk(main) if isinstance(n, ast.Try)]:
            for index, node in enumerate(statements):
                if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) and node.value.func.attr == "login":
                    self.assertEqual(ast.unparse(statements[index - 1]), "require_open_operating_session()")

    def test_recovery_itself_blocks_failed_stale_missing_on_closed_market(self) -> None:
        # Compile only the pure recovery function, never import the live bridge.
        tree = ast.parse((ROOT / "broker" / "shioaji_readonly_bridge.py").read_text(encoding="utf8"))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_recover_missing_quote_types_locked")
        for state in ["FAILED", "STALE", "MISSING"]:
            calls = []
            namespace = {"datetime": datetime, "Any": Any, "Mapping": Mapping,
                "tx_market_data_expected": lambda _: False,
                "quote_delivery_snapshot": lambda *_: calls.append(state)}
            exec(compile(ast.Module(body=[fn], type_ignores=[]), "offline-recovery", "exec"), namespace)
            result = namespace[fn.name](object(), {"TX": object()}, datetime.fromisoformat("2026-10-23T09:00:00+08:00"))
            self.assertEqual(result, 0)
            self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
