"""Offline synthetic diagnostics tests. Never import the Bridge or SDK."""
import ast
from contextlib import nullcontext
from datetime import datetime
import io
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "broker"))
from bridge_startup_diagnostics import (  # noqa: E402
    StartupDiagnostics, StartupStage, format_startup_failure,
    decode_credential_reader_failure,
)

SOURCE = (ROOT / "broker/shioaji_readonly_bridge.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)
CANARY = "SYNTHETIC_PRIVATE_CANARY_7192"


class HostileError(Exception):
    def __str__(self):
        raise AssertionError("diagnostics must not call str")

    def __repr__(self):
        raise AssertionError("diagnostics must not call repr")


class HostileOSError(OSError):
    @property
    def errno(self):
        raise AssertionError("subclass attribute must not be read")


class FormattingTests(unittest.TestCase):
    def record(self, error, stage=StartupStage.LOGIN):
        return json.loads(format_startup_failure(stage, error, role="primary"))

    def test_exact_known_type_and_no_message(self):
        serialized = format_startup_failure(StartupStage.LOGIN, RuntimeError(CANARY), role="primary")
        self.assertNotIn(CANARY, serialized)
        self.assertEqual(json.loads(serialized)["exceptionType"], "RuntimeError")
        self.assertEqual(set(json.loads(serialized)), {
            "schemaVersion", "event", "failureRole", "stage", "exceptionType",
            "safeErrorCode", "priorPrimaryFailure",
        })

    def test_hostile_string_and_subclass_attributes_are_never_read(self):
        for error in (HostileError(CANARY), HostileOSError(5, CANARY)):
            result = self.record(error)
            self.assertEqual(result["exceptionType"], "OTHER_EXCEPTION")
            self.assertIsNone(result["safeErrorCode"])

    def test_unknown_class_name_is_not_exposed(self):
        error_type = type(CANARY, (Exception,), {})
        serialized = format_startup_failure(StartupStage.SDK_CREATE, error_type(CANARY), role="primary")
        self.assertNotIn(CANARY, serialized)
        self.assertEqual(json.loads(serialized)["exceptionType"], "OTHER_EXCEPTION")

    def test_subprocess_outputs_command_and_attributes_do_not_escape(self):
        error = subprocess.CalledProcessError(1, [CANARY], output=CANARY, stderr=CANARY)
        error.account = CANARY
        serialized = format_startup_failure(StartupStage.CREDENTIAL_READ, error, role="primary")
        self.assertNotIn(CANARY, serialized)
        self.assertEqual(json.loads(serialized)["safeErrorCode"], {"domain": "CHILD_EXIT", "code": 1})

    def test_unknown_and_non_integer_child_codes_are_not_exposed(self):
        for code in (71927192, CANARY, True, HostileError()):
            result = self.record(subprocess.CalledProcessError(code, CANARY))
            self.assertEqual(result["safeErrorCode"], {"domain": "CHILD_EXIT", "code": "UNLISTED"})

    def test_os_codes_are_allowlisted(self):
        error = OSError(13, CANARY)
        self.assertEqual(self.record(error)["safeErrorCode"], {"domain": "ERRNO", "code": 13})
        error.winerror = 10048
        self.assertEqual(self.record(error)["safeErrorCode"], {"domain": "WINERROR", "code": 10048})
        error.winerror = 71927192
        self.assertEqual(self.record(error)["safeErrorCode"], {"domain": "WINERROR", "code": "UNLISTED"})
        del error.winerror
        error.errno = 71927192
        self.assertEqual(self.record(error)["safeErrorCode"], {"domain": "ERRNO", "code": "UNLISTED"})

    def test_json_error_never_exposes_document(self):
        error = json.JSONDecodeError(CANARY, CANARY, 0)
        serialized = format_startup_failure(StartupStage.CREDENTIAL_PARSE, error, role="primary")
        self.assertNotIn(CANARY, serialized)
        self.assertEqual(json.loads(serialized)["exceptionType"], "JSONDecodeError")

    def test_unknown_stage_and_role_are_bounded(self):
        result = json.loads(format_startup_failure(CANARY, RuntimeError(), role=CANARY))
        self.assertEqual(result["stage"], "UNKNOWN")
        self.assertEqual(result["failureRole"], "unknown")
        self.assertNotIn(CANARY, json.dumps(result))

    def test_formatter_failure_is_fixed_and_non_throwing(self):
        with patch("bridge_startup_diagnostics.json.dumps", side_effect=HostileError()):
            result = format_startup_failure(StartupStage.LOGIN, HostileError(), role="primary")
        self.assertEqual(json.loads(result)["diagnosticStatus"], "FORMAT_FAILED")

    def test_primary_and_cleanup_roles(self):
        state = StartupDiagnostics()
        state.stage = StartupStage.LOGIN
        first = json.loads(state.failure(RuntimeError(), role="primary"))
        state.stage = StartupStage.CLEANUP
        second = json.loads(state.failure(RuntimeError(), role="cleanup"))
        self.assertFalse(first["priorPrimaryFailure"])
        self.assertTrue(second["priorPrimaryFailure"])
        self.assertEqual([first["failureRole"], second["failureRole"]], ["primary", "cleanup"])


def extracted_functions(*names):
    selected = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(selected) == len(names)
    future = ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)
    module = ast.Module(body=[future, *selected], type_ignores=[])
    return compile(ast.fix_missing_locations(module), "<synthetic-bridge-functions>", "exec")


class Harness:
    """Runs only extracted function AST with inert fake resources and SDK."""
    def __init__(self, fail_stage=None, primary=None, cleanup=None):
        self.fail_stage = fail_stage
        self.primary = primary if primary is not None else RuntimeError(CANARY)
        self.cleanup = cleanup
        self.failed = False
        self.stderr = io.StringIO()
        self.classified = []
        self.calls = []
        self.ns = {
            "StartupStage": StartupStage, "StartupDiagnostics": StartupDiagnostics,
            "STARTUP_DIAGNOSTICS": StartupDiagnostics(), "sys": SimpleNamespace(stderr=self.stderr),
            "SERVER": None, "BRIDGE_STARTED_AT": None, "SHIOAJI_API": None,
            "HOST": "127.0.0.1", "PORT": 8790, "Handler": object(),
            "LOCK": nullcontext(), "QUEUE_STATE": {
                "callbackErrors": 0, "dropped": 0, "writerErrors": 0, "subscriptionGeneration": 0,
            },
            "CREDENTIAL_PATH": object(), "ROOT": Path("synthetic-only"),
            "FUTURES_METADATA": {}, "OPTIONS_METADATA": {}, "TXO_COLLECTION_STATE": {},
            "REQUIRED_SUBSCRIPTIONS": {name: {} for name in ("2330", "IX0001", "TX", "MTX", "TMF")},
            "LEADERSHIP_COLLECTION_ENABLED": False, "LEADERSHIP_HEALTH": {},
            "EXPECTED_STOP_REQUESTED": False, "datetime": datetime, "Path": Path,
            "os": SimpleNamespace(getpid=lambda: 123, getenv=lambda *args: ""),
            "print": lambda *args, **kwargs: print(*args, **kwargs) if kwargs.get("file") else None,
            "event_writer": lambda: None, "quote_delivery_watchdog": lambda: None,
            "record": lambda *args: None, "record_index_contribution": lambda *args: None,
            "record_industry_contribution": lambda *args: None,
            "mark_quote_subscribed": lambda *args: self.check(),
            "load_activation_config": lambda *args: self.config(),
            "record_lifecycle": lambda *args, **kwargs: self.check(),
            "acquire_single_instance": lambda: self.check(),
            "release_single_instance": lambda *args: None,
            "tx_market_data_expected": lambda: True,
            "load_credentials": lambda *args: self.credentials(),
            "signal": SimpleNamespace(SIGINT=2, SIGTERM=15, signal=lambda *args: self.check()),
            "threading": SimpleNamespace(Thread=lambda **kwargs: self.thread(), Event=lambda: self.event()),
            "ThreadingHTTPServer": lambda *args: self.server(),
            "EVENT_QUEUE": SimpleNamespace(join=self.cleanup_check, put=lambda *args: None),
            "sj": SimpleNamespace(Shioaji=lambda **kwargs: self.sdk(), QuoteType=SimpleNamespace(
                Tick="Tick", BidAsk="BidAsk", Quote="Quote")),
        }
        exec(extracted_functions("require_open_operating_session", "record_startup_failure", "main"), self.ns)
        # Reuse the actual outer exception wrapper without executing module-level code.
        entry = next(node for node in TREE.body if isinstance(node, ast.If)
                     and isinstance(node.test, ast.Compare)
                     and isinstance(node.test.left, ast.Name) and node.test.left.id == "__name__")
        wrapper = ast.FunctionDef(name="entrypoint", args=ast.arguments(
            posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
            body=entry.body, decorator_list=[])
        exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[])),
                     "<synthetic-entrypoint>", "exec"), self.ns)
        self.ns["startup_exit_code"] = self.classifier

    def check(self):
        stage = self.ns["STARTUP_DIAGNOSTICS"].stage
        self.calls.append(stage)
        if stage is self.fail_stage and not self.failed:
            self.failed = True
            raise self.primary
        return object()

    def credentials(self):
        self.check()
        self.ns["STARTUP_DIAGNOSTICS"].stage = StartupStage.CREDENTIAL_PARSE
        self.check()
        return {"apiKey": "synthetic-key", "secretKey": "synthetic-secret", "production": False}

    def config(self):
        self.check()
        return {"enabled": False}

    def thread(self):
        self.check()
        return SimpleNamespace(start=self.check, join=lambda **kwargs: None, is_alive=lambda: False)

    def event(self):
        return SimpleNamespace(is_set=lambda: False, set=lambda: None)

    def server(self):
        self.check()
        return SimpleNamespace(serve_forever=self.check, shutdown=lambda: None, server_close=lambda: None)

    def sdk(self):
        self.check()
        api = SimpleNamespace(
            login=lambda **kwargs: self.check(), logout=lambda: None,
            subscribe=lambda *args, **kwargs: self.check(), unsubscribe=lambda *args, **kwargs: None,
            contracts=SimpleNamespace(get=lambda alias: self.contract(alias)),
        )
        for name in ("set_on_tick_stk_v1_callback", "set_on_quote_idx_v1_callback",
                     "set_on_tick_fop_v1_callback", "set_on_bidask_fop_v1_callback",
                     "set_on_index_contribution_callback", "set_on_industry_contribution_callback",
                     "set_event_callback", "set_session_down_callback"):
            setattr(api, name, lambda *args: self.check())
        return api

    def contract(self, alias):
        self.check()
        return SimpleNamespace(code=alias, target_code=alias)

    def cleanup_check(self):
        if self.cleanup is not None:
            raise self.cleanup

    def classifier(self, error):
        self.classified.append(error)
        return 1, "UNKNOWN_INSUFFICIENT_EVIDENCE"

    def run(self):
        try:
            self.ns["entrypoint"]()
        except SystemExit as error:
            return error.code
        return 0

    def records(self):
        return [json.loads(line) for line in self.stderr.getvalue().splitlines() if line.startswith("{")]


class SyntheticMainTests(unittest.TestCase):
    def test_closed_market_stops_before_singleton_or_resources(self):
        harness = Harness()
        harness.ns["tx_market_data_expected"] = lambda: False
        self.assertEqual(harness.run(), 76)
        self.assertEqual(harness.calls, [])
        self.assertEqual(harness.records(), [])

    def test_market_closing_before_credentials_does_not_read_or_construct_sdk(self):
        harness = Harness()
        clock = iter((True, False))
        harness.ns["tx_market_data_expected"] = lambda: next(clock)
        self.assertEqual(harness.run(), 76)
        self.assertNotIn(StartupStage.CREDENTIAL_READ, harness.calls)
        self.assertNotIn(StartupStage.SDK_CREATE, harness.calls)
        self.assertNotIn(StartupStage.LOGIN, harness.calls)
        self.assertEqual(harness.records(), [])

    def test_market_closing_before_login_does_not_call_login(self):
        harness = Harness()
        clock = iter((True, True, False))
        harness.ns["tx_market_data_expected"] = lambda: next(clock)
        self.assertEqual(harness.run(), 76)
        self.assertIn(StartupStage.CREDENTIAL_PARSE, harness.calls)
        self.assertIn(StartupStage.SDK_CREATE, harness.calls)
        self.assertNotIn(StartupStage.LOGIN, harness.calls)
        self.assertEqual(harness.records(), [])

    def test_open_market_rechecks_all_three_boundaries_without_failure(self):
        harness = Harness()
        checks = []
        def open_market():
            checks.append(harness.ns["STARTUP_DIAGNOSTICS"].stage)
            return True
        harness.ns["tx_market_data_expected"] = open_market
        self.assertEqual(harness.run(), 0)
        self.assertEqual(checks, [StartupStage.SINGLETON, StartupStage.CREDENTIAL_READ, StartupStage.LOGIN])
        self.assertEqual(harness.records(), [])

    def test_each_startup_stage_is_localized_once(self):
        stages = [stage for stage in StartupStage if stage not in (StartupStage.UNKNOWN, StartupStage.CLEANUP)]
        for stage in stages:
            with self.subTest(stage=stage):
                harness = Harness(fail_stage=stage)
                self.assertEqual(harness.run(), 1)
                records = harness.records()
                self.assertEqual(len(records), 1)
                self.assertEqual(records[0]["stage"], stage.value)
                self.assertEqual(records[0]["failureRole"], "primary")
                self.assertIs(harness.classified[0], harness.primary)
                self.assertNotIn(CANARY, harness.stderr.getvalue())

    def test_primary_then_cleanup_preserves_original_cleanup_priority(self):
        primary, cleanup = RuntimeError(CANARY), OSError(5, CANARY)
        harness = Harness(StartupStage.LOGIN, primary, cleanup)
        self.assertEqual(harness.run(), 1)
        records = harness.records()
        self.assertEqual([r["failureRole"] for r in records], ["primary", "cleanup"])
        self.assertEqual([r["stage"] for r in records], ["LOGIN", "CLEANUP"])
        self.assertTrue(records[1]["priorPrimaryFailure"])
        self.assertIs(harness.classified[0], cleanup)

    def test_cleanup_only_is_not_mislabeled_as_primary(self):
        cleanup = RuntimeError(CANARY)
        harness = Harness(cleanup=cleanup)
        self.assertEqual(harness.run(), 1)
        self.assertEqual(len(harness.records()), 1)
        self.assertEqual(harness.records()[0]["failureRole"], "cleanup")
        self.assertFalse(harness.records()[0]["priorPrimaryFailure"])
        self.assertIs(harness.classified[0], cleanup)

    def test_success_has_no_failure_record(self):
        harness = Harness()
        self.assertEqual(harness.run(), 0)
        self.assertEqual(harness.records(), [])

    def test_expected_stop_exit_code_unchanged(self):
        harness = Harness()
        harness.ns["EXPECTED_STOP_REQUESTED"] = True
        self.assertEqual(harness.run(), 76)
        self.assertEqual(harness.records(), [])

    def test_diagnostic_sink_failure_does_not_replace_primary(self):
        primary = HostileError()
        harness = Harness(StartupStage.LOGIN, primary)
        harness.ns["sys"].stderr = SimpleNamespace(write=lambda *args: (_ for _ in ()).throw(OSError()))
        # Run main directly; the outer legacy formatter is intentionally unchanged.
        with self.assertRaises(HostileError) as caught:
            harness.ns["main"]()
        self.assertIs(caught.exception, primary)

    def test_diagnostic_formatter_failure_does_not_replace_primary(self):
        primary = HostileError()
        harness = Harness(StartupStage.LOGIN, primary)
        with patch("bridge_startup_diagnostics.format_startup_failure", side_effect=RuntimeError()):
            with self.assertRaises(HostileError) as caught:
                harness.ns["main"]()
        self.assertIs(caught.exception, primary)


class StaticSafetyTests(unittest.TestCase):
    def test_single_login_still_disables_trade_subscription(self):
        calls = [node for node in ast.walk(TREE) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Attribute) and node.func.attr == "login"]
        self.assertEqual(len(calls), 1)
        flag = next(keyword.value for keyword in calls[0].keywords if keyword.arg == "subscribe_trade")
        self.assertIs(flag.value, False)

    def test_no_order_or_certificate_call_added(self):
        forbidden = {"place_order", "cancel_order", "activate_ca", "update_order",
                     "list_positions", "account_balance", "margin"}
        self.assertFalse([node for node in ast.walk(TREE) if isinstance(node, ast.Call)
                          and isinstance(node.func, ast.Attribute) and node.func.attr in forbidden])

    def test_credential_parse_stage_is_before_decode(self):
        node = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "load_credentials")
        stage = next(index for index, item in enumerate(node.body) if isinstance(item, ast.Assign)
                     and isinstance(item.value, ast.Attribute) and item.value.attr == "CREDENTIAL_PARSE")
        decode = next(index for index, item in enumerate(node.body) if isinstance(item, ast.Assign)
                      and isinstance(item.value, ast.Call) and isinstance(item.value.func, ast.Attribute)
                      and item.value.func.attr == "loads")
        self.assertLess(stage, decode)

    def test_original_exit_classifier_ast_is_unchanged(self):
        nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "startup_exit_code"]
        self.assertEqual(len(nodes), 1)
        node = nodes[0]
        # Frozen source from approved main 4d825168, parsed by the same interpreter.
        # ast.dump includes version-specific empty fields and is not a stable digest.
        expected = ast.parse('''def startup_exit_code(error: Exception) -> tuple[int, str]:
    text = f"{type(error).__name__} {str(error)}".lower()[:4096]
    if "dpapi credential" in text or "api key" in text or "secret key" in text or "token" in text:
        return 77, "AUTH_OR_TOKEN_FAILURE"
    if "unauthorized" in text or "authentication" in text or "login" in text:
        return 80, "LOGIN_FAILED"
    if "network" in text or "connection" in text or "socket" in text or "timeout" in text or "dns" in text:
        return 78, "NETWORK_UNAVAILABLE"
    if isinstance(error, LookupError) or "subscribe" in text or "contract not found" in text:
        return 79, "SUBSCRIPTION_RESTORE_FAILED"
    return 1, "UNKNOWN_INSUFFICIENT_EVIDENCE"
''').body[0]
        self.assertEqual(ast.dump(node, include_attributes=False), ast.dump(expected, include_attributes=False))

    def test_helper_has_no_io_sdk_or_raw_exception_access(self):
        helper = ast.parse((ROOT / "broker/bridge_startup_diagnostics.py").read_text(encoding="utf-8"))
        imports = {node.module for node in ast.walk(helper) if isinstance(node, ast.ImportFrom)}
        imports.update(alias.name for node in ast.walk(helper) if isinstance(node, ast.Import) for alias in node.names)
        self.assertEqual(imports, {"enum", "json", "subprocess"})
        forbidden_attributes = {"args", "stdout", "stderr", "output", "cmd", "__traceback__", "__dict__"}
        self.assertFalse([node for node in ast.walk(helper) if isinstance(node, ast.Attribute)
                          and node.attr in forbidden_attributes])
        self.assertFalse([node for node in ast.walk(helper) if isinstance(node, ast.Call)
                          and isinstance(node.func, ast.Name) and node.func.id in {"str", "repr", "open", "print"}])


def reader_fixture(stage="DPAPI_DECRYPT"):
    return {
        "schemaVersion": 1,
        "event": "shioaji_credential_reader_failure",
        "stage": stage,
        "exceptions": [{
            "type": "System.Security.Cryptography.CryptographicException",
            "hresult": "0x8009000B",
        }],
        "exitCode": 1,
    }


class ReaderDecoderTests(unittest.TestCase):
    def decode(self, record):
        return decode_credential_reader_failure(json.dumps(record))

    def test_valid_record_is_rebuilt_without_surrounding_child_noise(self):
        fixture = reader_fixture()
        raw = CANARY + "\n  " + json.dumps(fixture, indent=None) + "\n" + CANARY
        decoded = decode_credential_reader_failure(raw)
        self.assertEqual(json.loads(decoded), fixture)
        self.assertNotEqual(decoded, raw)
        self.assertNotIn(CANARY, decoded)
        self.assertNotIn("\n", decoded)

    def test_all_agreed_stages_types_and_hresult_values(self):
        stages = ("FILE_READ", "JSON_PARSE", "FORMAT_CHECK", "DPAPI_DECRYPT",
                  "MARSHAL", "SERIALIZE", "UNKNOWN")
        types = (
            "System.IO.IOException", "System.IO.FileNotFoundException",
            "System.IO.DirectoryNotFoundException", "System.UnauthorizedAccessException",
            "System.Security.Cryptography.CryptographicException", "System.ArgumentException",
            "System.InvalidOperationException", "System.FormatException",
            "System.Management.Automation.RuntimeException",
            "System.Management.Automation.PSArgumentException",
            "System.Management.Automation.PSInvalidOperationException",
            "System.Management.Automation.ItemNotFoundException",
            "System.Management.Automation.MethodInvocationException",
            "System.Management.Automation.ParameterBindingException",
            "System.Management.Automation.CmdletInvocationException",
            "System.Management.Automation.ActionPreferenceStopException", "OTHER_EXCEPTION",
        )
        codes = ("0x80070002", "0x80070003", "0x80070005", "0x8007000D",
                 "0x80070057", "0x80090005", "0x8009000B", "UNLISTED")
        for stage in stages:
            self.assertIsNotNone(self.decode(reader_fixture(stage)))
        for exception_type in types:
            for code in codes:
                fixture = reader_fixture()
                fixture["exceptions"] = [{"type": exception_type, "hresult": code}]
                self.assertIsNotNone(self.decode(fixture))

    def test_exact_keys_at_both_levels(self):
        fixture = reader_fixture()
        for key in tuple(fixture):
            candidate = reader_fixture()
            del candidate[key]
            self.assertIsNone(self.decode(candidate))
        for target in ("top", "nested"):
            candidate = reader_fixture()
            item = candidate if target == "top" else candidate["exceptions"][0]
            item["message"] = CANARY
            self.assertIsNone(self.decode(candidate))
        for key in ("type", "hresult"):
            candidate = reader_fixture()
            del candidate["exceptions"][0][key]
            self.assertIsNone(self.decode(candidate))

    def test_unknown_and_wrongly_typed_values_are_rejected(self):
        for key in ("schemaVersion", "exitCode"):
            for value in (True, False, 1.0, "1", 0, 2, None):
                candidate = reader_fixture()
                candidate[key] = value
                self.assertIsNone(self.decode(candidate))
        for key in ("event", "stage"):
            for value in (CANARY, None, [], {}, 1, True):
                candidate = reader_fixture()
                candidate[key] = value
                self.assertIsNone(self.decode(candidate))
        for key in ("type", "hresult"):
            for value in (CANARY, None, [], {}, 1, True, "0x8009000b"):
                candidate = reader_fixture()
                candidate["exceptions"][0][key] = value
                self.assertIsNone(self.decode(candidate))

    def test_exception_chain_is_a_nonempty_array_of_at_most_three(self):
        for value in ([], {}, None, CANARY, [None], [reader_fixture()["exceptions"][0]] * 4):
            candidate = reader_fixture()
            candidate["exceptions"] = value
            self.assertIsNone(self.decode(candidate))
        candidate = reader_fixture()
        candidate["exceptions"] *= 3
        self.assertEqual(len(json.loads(self.decode(candidate))["exceptions"]), 3)

    def test_duplicate_keys_including_nested_and_escaped_are_rejected(self):
        raw = json.dumps(reader_fixture())
        duplicated = (
            raw.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1'),
            raw.replace('"schemaVersion": 1', '"schemaVersion": 1, "schema\\u0056ersion": 1'),
            raw.replace('"hresult": "0x8009000B"', '"hresult": "0x8009000B", "hresult": "UNLISTED"'),
            raw.replace('"type":', '"type": "OTHER_EXCEPTION", "type":'),
        )
        for candidate in duplicated:
            self.assertIsNone(decode_credential_reader_failure(candidate))

    def test_nonfinite_constants_and_malformed_json_fail_closed(self):
        raw = json.dumps(reader_fixture())
        for constant in ("NaN", "Infinity", "-Infinity"):
            self.assertIsNone(decode_credential_reader_failure(
                raw.replace('"schemaVersion": 1', '"schemaVersion": ' + constant)))
        for candidate in ("{", raw + " trailing", raw + "\n{", "{bad}\n" + raw):
            self.assertIsNone(decode_credential_reader_failure(candidate))

    def test_multiple_records_are_rejected_even_if_identical(self):
        raw = json.dumps(reader_fixture())
        self.assertIsNone(decode_credential_reader_failure(raw + "\n" + raw))
        self.assertIsNone(decode_credential_reader_failure(raw + raw))
        invalid = reader_fixture()
        invalid["extra"] = CANARY
        self.assertIsNone(decode_credential_reader_failure(raw + "\n" + json.dumps(invalid)))

    def test_size_limits_are_checked_before_json_parse(self):
        raw = json.dumps(reader_fixture())
        too_large = (
            "x" * (16 * 1024 + 1), "é" * (8 * 1024 + 1),
            "x" * (2 * 1024 + 1) + "\n" + raw,
            "é" * 1025 + "\n" + raw,
            "\n".join(["noise"] * 64 + [raw]),
        )
        with patch("bridge_startup_diagnostics.json.loads", side_effect=AssertionError("must reject first")) as parse:
            for candidate in too_large:
                self.assertIsNone(decode_credential_reader_failure(candidate))
            parse.assert_not_called()
        self.assertIsNotNone(decode_credential_reader_failure("\n".join(["noise"] * 63 + [raw])))
        self.assertIsNotNone(decode_credential_reader_failure(" " * (2048 - len(raw)) + raw))

    def test_wrong_input_type_surrogate_and_nested_bombs_are_rejected(self):
        class HostileString(str):
            def encode(self, *args, **kwargs):
                raise AssertionError("must not call subclass")
        for candidate in (None, b"{}", [], {}, HostileString("{}"), "\ud800"):
            self.assertIsNone(decode_credential_reader_failure(candidate))
        self.assertIsNone(decode_credential_reader_failure(
            '{"nested":' + "[" * 1000 + "0" + "]" * 1000 + "}"))

    def test_decoder_failure_cannot_escape(self):
        with patch("bridge_startup_diagnostics.json.loads", side_effect=HostileError()):
            self.assertIsNone(decode_credential_reader_failure(json.dumps(reader_fixture())))


class ReaderForwardingTests(unittest.TestCase):
    def prepare(self, run, *, decoder=decode_credential_reader_failure, sink=None):
        state = StartupDiagnostics()
        stderr = io.StringIO() if sink is None else sink
        namespace = {
            "os": SimpleNamespace(environ={"PSModulePath": "foreign", "KEEP": "yes"}),
            "STARTUP_DIAGNOSTICS": state, "StartupStage": StartupStage,
            "subprocess": SimpleNamespace(run=run, CalledProcessError=subprocess.CalledProcessError),
            "decode_credential_reader_failure": decoder,
            "CREDENTIAL_READER": Path("synthetic-reader.ps1"),
            "sys": SimpleNamespace(stderr=stderr), "json": json,
        }
        exec(extracted_functions("load_credentials"), namespace)
        return namespace, state, stderr

    def test_only_valid_reader_row_is_forwarded_and_original_error_rethrown(self):
        fixture = reader_fixture()
        original = subprocess.CalledProcessError(
            1, [CANARY], output=CANARY, stderr=CANARY + "\n" + json.dumps(fixture) + "\n" + CANARY)
        def run(*args, **kwargs):
            self.assertTrue(kwargs["check"])
            self.assertTrue(kwargs["capture_output"])
            self.assertTrue(kwargs["text"])
            raise original
        namespace, state, stderr = self.prepare(run)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            namespace["load_credentials"](SimpleNamespace(exists=lambda: True))
        self.assertIs(caught.exception, original)
        self.assertIs(state.stage, StartupStage.CREDENTIAL_READ)
        self.assertEqual(len(stderr.getvalue().splitlines()), 1)
        self.assertEqual(json.loads(stderr.getvalue()), fixture)
        self.assertNotIn(CANARY, stderr.getvalue())

    def test_untrusted_child_output_is_never_forwarded(self):
        fixture = reader_fixture()
        fixture["message"] = CANARY
        for raw in (CANARY, json.dumps(fixture), json.dumps(reader_fixture()) * 2, None):
            original = subprocess.CalledProcessError(1, CANARY, output=CANARY, stderr=raw)
            def run(*args, **kwargs):
                raise original
            namespace, state, stderr = self.prepare(run)
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                namespace["load_credentials"](SimpleNamespace(exists=lambda: True))
            self.assertIs(caught.exception, original)
            self.assertEqual(stderr.getvalue(), "")
            self.assertIs(state.stage, StartupStage.CREDENTIAL_READ)

    def test_decoder_and_sink_failures_do_not_mask_original(self):
        original = subprocess.CalledProcessError(1, CANARY, stderr=json.dumps(reader_fixture()))
        def run(*args, **kwargs):
            raise original
        def broken(*args, **kwargs):
            raise HostileError()
        for overrides in ({"decoder": broken}, {"sink": SimpleNamespace(write=broken)}):
            namespace, state, _ = self.prepare(run, **overrides)
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                namespace["load_credentials"](SimpleNamespace(exists=lambda: True))
            self.assertIs(caught.exception, original)
            self.assertIs(state.stage, StartupStage.CREDENTIAL_READ)

    def test_other_subprocess_failure_is_not_reclassified_or_forwarded(self):
        original = OSError(2, CANARY)
        def run(*args, **kwargs):
            raise original
        namespace, state, stderr = self.prepare(run)
        with self.assertRaises(OSError) as caught:
            namespace["load_credentials"](SimpleNamespace(exists=lambda: True))
        self.assertIs(caught.exception, original)
        self.assertEqual(stderr.getvalue(), "")
        self.assertIs(state.stage, StartupStage.CREDENTIAL_READ)

    def test_success_stdout_protocol_is_unchanged_and_stderr_is_not_forwarded(self):
        payload = {"apiKey": "synthetic-only", "secretKey": "synthetic-only", "production": False}
        namespace, state, stderr = self.prepare(
            lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps(payload), stderr=json.dumps(reader_fixture())))
        result = namespace["load_credentials"](SimpleNamespace(exists=lambda: True))
        self.assertEqual(result, payload)
        self.assertEqual(stderr.getvalue(), "")
        self.assertIs(state.stage, StartupStage.CREDENTIAL_PARSE)

    def test_success_stdout_parse_failure_remains_parse_stage(self):
        namespace, state, stderr = self.prepare(
            lambda *args, **kwargs: SimpleNamespace(stdout="not-json", stderr=json.dumps(reader_fixture())))
        with self.assertRaises(json.JSONDecodeError):
            namespace["load_credentials"](SimpleNamespace(exists=lambda: True))
        self.assertEqual(stderr.getvalue(), "")
        self.assertIs(state.stage, StartupStage.CREDENTIAL_PARSE)


if __name__ == "__main__":
    unittest.main()
