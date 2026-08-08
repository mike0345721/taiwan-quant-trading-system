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


if __name__ == "__main__":
    unittest.main()
