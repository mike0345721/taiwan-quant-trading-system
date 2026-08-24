import ast
import sys
import unittest
from datetime import datetime
from enum import Enum
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "broker"))

from shioaji_readonly_bridge import safe_value  # noqa: E402


class ExchangeLike(Enum):
    TSE = "TSE"


class CallbackPayload:
    def to_dict(self, raw=True):
        return {
            "code": "2330",
            "exchange": ExchangeLike.TSE,
            "datetime": datetime(2026, 7, 27, 9, 0, 0),
        }


class SafeValueTests(unittest.TestCase):
    def test_callback_payload_is_json_safe(self):
        normalized = safe_value(CallbackPayload().to_dict(raw=True))
        self.assertEqual(normalized["exchange"], "TSE")
        self.assertEqual(normalized["datetime"], "2026-07-27T09:00:00")


class MarketDataOnlyLoginTests(unittest.TestCase):
    def test_bridge_disables_trade_event_subscription_at_login(self):
        bridge_path = ROOT / "broker" / "shioaji_readonly_bridge.py"
        tree = ast.parse(bridge_path.read_text(encoding="utf-8"))
        login_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "login"
        ]

        self.assertEqual(len(login_calls), 1)
        subscribe_trade = next(
            (
                keyword.value
                for keyword in login_calls[0].keywords
                if keyword.arg == "subscribe_trade"
            ),
            None,
        )
        self.assertIsInstance(subscribe_trade, ast.Constant)
        self.assertIs(subscribe_trade.value, False)


if __name__ == "__main__":
    unittest.main()
