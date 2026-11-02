"""Exercise the real Python reader with synthetic paths and a mocked child process.

No SDK import, broker login, PowerShell execution, or credential-file access occurs.
These tests do not establish that Windows permits the real reader to run.
"""
import ast
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock


BRIDGE = Path(__file__).resolve().parents[1] / "broker" / "shioaji_readonly_bridge.py"
sys.path.insert(0, str(BRIDGE.parent))
from bridge_startup_diagnostics import StartupDiagnostics, StartupStage, decode_credential_reader_failure

TREE = ast.parse(BRIDGE.read_text(encoding="utf-8"), filename=str(BRIDGE))
NODES = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "load_credentials"]
if len(NODES) != 1:
    raise RuntimeError("EXPECTED_ONE_REAL_CREDENTIAL_READER")
READER = compile(ast.Module(body=NODES, type_ignores=[]), str(BRIDGE), "exec")


class SyntheticCredentialPath:
    def __init__(self, exists=True):
        self.exists = Mock(return_value=exists)

    def __str__(self):
        return "C:\\synthetic only\\never-read.json"


class CredentialReaderPolicyTests(unittest.TestCase):
    def setUp(self):
        self.record = {"apiKey": "fixture-key-not-real", "secretKey": "fixture-secret-not-real", "production": False}
        self.run = Mock(return_value=SimpleNamespace(stdout=json.dumps(self.record)))
        self.environment = {"PSModulePath": "synthetic-foreign-modules", "KEEP": "synthetic-value"}
        self.diagnostics = StartupDiagnostics()
        self.stderr = io.StringIO()
        self.namespace = {
            "Path": Path,
            "Any": Any,
            "json": json,
            "subprocess": SimpleNamespace(run=self.run, CREATE_NO_WINDOW=0x08000000, CalledProcessError=subprocess.CalledProcessError),
            "os": SimpleNamespace(environ=self.environment),
            "sys": SimpleNamespace(stderr=self.stderr),
            "STARTUP_DIAGNOSTICS": self.diagnostics,
            "StartupStage": StartupStage,
            "decode_credential_reader_failure": decode_credential_reader_failure,
            "CREDENTIAL_READER": PureWindowsPath("C:/synthetic only/read-shioaji-credentials.ps1"),
        }
        exec(READER, self.namespace)
        self.read = self.namespace["load_credentials"]
        self.path = SyntheticCredentialPath()

    def test_reader_respects_policy_and_preserves_hidden_dpapi_transport(self):
        self.assertEqual(self.read(self.path), self.record)
        self.run.assert_called_once()
        args, kwargs = self.run.call_args
        command = args[0]
        self.assertEqual(command, [
            "powershell", "-NoProfile", "-NonInteractive", "-File",
            str(self.namespace["CREDENTIAL_READER"]), "-Path", str(self.path),
        ])
        self.assertNotIn("-ExecutionPolicy", command)
        self.assertNotIn("Bypass", command)
        self.assertEqual(kwargs, {
            "check": True, "capture_output": True, "text": True, "creationflags": 0x08000000,
            "env": {"KEEP": "synthetic-value"},
        })
        self.assertEqual(self.environment, {"PSModulePath": "synthetic-foreign-modules", "KEEP": "synthetic-value"})
        self.assertEqual(self.diagnostics.stage, StartupStage.CREDENTIAL_PARSE)
        self.path.exists.assert_called_once_with()

    def test_missing_file_fails_before_creating_any_child(self):
        with self.assertRaisesRegex(RuntimeError, "missing DPAPI credentials"):
            self.read(SyntheticCredentialPath(exists=False))
        self.run.assert_not_called()

    def test_policy_denial_propagates_without_retry_or_alternative_command(self):
        denial = subprocess.CalledProcessError(1, "synthetic reader", stderr="running scripts is disabled")
        self.run.side_effect = denial
        with self.assertRaises(subprocess.CalledProcessError) as result:
            self.read(self.path)
        self.assertIs(result.exception, denial)
        self.assertEqual(self.run.call_count, 1)
        self.assertEqual(self.diagnostics.stage, StartupStage.CREDENTIAL_READ)
        self.assertEqual(self.stderr.getvalue(), "")

    def test_process_creation_denial_is_not_replaced_by_a_fallback(self):
        denial = PermissionError("synthetic process denied")
        self.run.side_effect = denial
        with self.assertRaises(PermissionError) as result:
            self.read(self.path)
        self.assertIs(result.exception, denial)
        self.assertEqual(self.run.call_count, 1)

    def test_malformed_child_output_is_rejected(self):
        self.run.return_value.stdout = "synthetic invalid JSON"
        with self.assertRaises(json.JSONDecodeError):
            self.read(self.path)
        self.assertEqual(self.run.call_count, 1)

    def test_incomplete_child_record_is_rejected_without_retry(self):
        for record in ({}, {"apiKey": "fixture-key-not-real"}, {"secretKey": "fixture-secret-not-real"}):
            with self.subTest(record_keys=list(record)):
                self.run.reset_mock()
                self.run.return_value.stdout = json.dumps(record)
                with self.assertRaisesRegex(RuntimeError, "DPAPI credentials are incomplete"):
                    self.read(self.path)
                self.assertEqual(self.run.call_count, 1)


if __name__ == "__main__":
    unittest.main()
