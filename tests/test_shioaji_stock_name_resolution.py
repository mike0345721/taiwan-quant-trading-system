"""Cold-cache contract-info regression, with no SDK login or collector side effects.

Execute the real resolver's AST, not a rewritten test implementation. The SDK
contract handle intentionally has no name, as documented for Shioaji >= 1.7.
This proves resolver behavior only; real 8790/8787 acceptance remains separate.
"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


BRIDGE = Path(__file__).resolve().parents[1] / "broker" / "shioaji_readonly_bridge.py"
TREE = ast.parse(BRIDGE.read_text(encoding="utf-8"), filename=str(BRIDGE))
RESOLVER_NODES = [
    node for node in TREE.body
    if isinstance(node, ast.FunctionDef) and node.name == "resolve_stock_name"
]
if len(RESOLVER_NODES) != 1:
    raise RuntimeError("EXPECTED_ONE_REAL_STOCK_NAME_RESOLVER")
RESOLVER = compile(ast.Module(body=RESOLVER_NODES, type_ignores=[]), str(BRIDGE), "exec")


class StockNameResolutionTests(unittest.TestCase):
    def setUp(self):
        self.handle = SimpleNamespace(code="2330", security_type="STK", exchange="TSE")
        self.details = SimpleNamespace(code="2330", name="台積電")
        self.contracts = SimpleNamespace(
            get=Mock(return_value=self.handle), info=Mock(return_value=self.details)
        )
        self.cache = {}
        self.namespace = {
            "SHIOAJI_API": SimpleNamespace(contracts=self.contracts),
            "STOCK_NAME_CACHE": self.cache,
        }
        exec(RESOLVER, self.namespace)
        self.resolve = self.namespace["resolve_stock_name"]

    def test_cold_cache_uses_info_on_nameless_contract_handle(self):
        self.assertFalse(hasattr(self.handle, "name"))
        self.assertEqual(self.resolve("2330"), "台積電")
        self.contracts.get.assert_called_once_with("2330")
        self.contracts.info.assert_called_once_with(self.handle)
        self.assertEqual(self.cache, {"2330": "台積電"})

    def test_success_is_trimmed_and_cached_without_repeated_sdk_calls(self):
        self.details.name = " 台積電 \n"
        self.assertEqual(self.resolve(" 2330 "), "台積電")
        self.assertEqual(self.resolve("2330"), "台積電")
        self.assertEqual(self.contracts.get.call_count, 1)
        self.assertEqual(self.contracts.info.call_count, 1)

    def test_names_are_scoped_to_each_code(self):
        names = {"2330": "台積電", "2317": "鴻海", "2454": "聯發科"}
        self.contracts.get.side_effect = lambda code: SimpleNamespace(code=code)
        self.contracts.info.side_effect = lambda handle: SimpleNamespace(
            code=handle.code, name=names[handle.code]
        )
        for code, name in names.items():
            self.assertEqual(self.resolve(code), name)
        self.assertEqual(self.cache, names)

    def test_no_api_remains_unknown(self):
        self.namespace["SHIOAJI_API"] = None
        self.assertIsNone(self.resolve("2330"))
        self.contracts.get.assert_not_called()
        self.assertEqual(self.cache, {})

    def test_empty_code_does_not_query_sdk(self):
        for code in (None, "", " "):
            self.assertIsNone(self.resolve(code))
        self.contracts.get.assert_not_called()
        self.contracts.info.assert_not_called()

    def test_missing_contract_does_not_request_info(self):
        self.contracts.get.return_value = None
        self.assertIsNone(self.resolve("2330"))
        self.contracts.info.assert_not_called()
        self.assertEqual(self.cache, {})

    def test_missing_info_does_not_poison_cache(self):
        self.contracts.info.return_value = None
        self.assertIsNone(self.resolve("2330"))
        self.assertEqual(self.cache, {})

    def test_missing_info_code_is_not_bound_to_requested_stock(self):
        self.contracts.info.return_value = SimpleNamespace(name="台積電")
        self.assertIsNone(self.resolve("2330"))
        self.assertEqual(self.cache, {})

    def test_mismatched_info_code_is_rejected(self):
        self.contracts.info.return_value = SimpleNamespace(code="2317", name="鴻海")
        self.assertIsNone(self.resolve("2330"))
        self.assertEqual(self.cache, {})

    def test_missing_or_non_text_names_remain_unknown(self):
        for value in (None, "", "  ", 2330, False, [], {}, object()):
            with self.subTest(name_type=type(value).__name__):
                self.details.name = value
                self.assertIsNone(self.resolve("2330"))
                self.assertEqual(self.cache, {})

    def test_contract_handle_name_does_not_replace_missing_details(self):
        self.handle.name = "不得使用的舊名稱"
        self.contracts.info.return_value = None
        self.assertIsNone(self.resolve("2330"))
        self.assertEqual(self.cache, {})

    def test_get_failure_is_unknown_and_a_later_call_can_recover(self):
        self.contracts.get.side_effect = [RuntimeError("fixture lookup failure"), self.handle]
        self.assertIsNone(self.resolve("2330"))
        self.assertEqual(self.cache, {})
        self.assertEqual(self.resolve("2330"), "台積電")

    def test_info_failure_is_unknown_and_a_later_call_can_recover(self):
        self.contracts.info.side_effect = [RuntimeError("fixture info failure"), self.details]
        self.assertIsNone(self.resolve("2330"))
        self.assertEqual(self.cache, {})
        self.assertEqual(self.resolve("2330"), "台積電")


if __name__ == "__main__":
    unittest.main(verbosity=2)
