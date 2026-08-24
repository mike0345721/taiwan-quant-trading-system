import ast
import sys
import unittest
from datetime import datetime
from enum import Enum
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "broker"))

from shioaji_readonly_bridge import (  # noqa: E402
    INDUSTRY_POINTS_TOLERANCE,
    LEADERSHIP_COLLECTION_ENABLED,
    leadership_payload,
    normalize_index_contribution,
    normalize_industry_contribution,
    safe_value,
)


class ExchangeLike(Enum):
    TSE = "TSE"


class CallbackPayload:
    def to_dict(self, raw=True):
        return {
            "code": "2330",
            "exchange": ExchangeLike.TSE,
            "datetime": datetime(2026, 7, 27, 9, 0, 0),
        }


class EnrichedPayload:
    def __init__(self, payload):
        self.payload = payload

    def to_dict(self, raw=True):
        return self.payload


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

    def test_enriched_rankings_reuse_ix0001_and_the_single_existing_login(self):
        bridge_path = ROOT / "broker" / "shioaji_readonly_bridge.py"
        tree = ast.parse(bridge_path.read_text(encoding="utf-8"))
        shioaji_constructors = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "Shioaji"
        ]
        login_calls = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "login"
        ]
        self.assertEqual(len(shioaji_constructors), 1)
        self.assertEqual(len(login_calls), 1)
        source = bridge_path.read_text(encoding="utf-8")
        for ranking in ("Abs10", "Positive25", "Negative25"):
            self.assertIn(f"sj.ContributionRanking.{ranking}", source)
        self.assertIn("quote_type=sj.QuoteType.IndexContribution", source)
        self.assertIn("quote_type=sj.QuoteType.IndustryContribution", source)
        self.assertIn("api.set_on_index_contribution_callback", source)
        self.assertIn("api.set_on_industry_contribution_callback", source)
        self.assertIn("api.unsubscribe(contract, quote_type=quote_type, ranking=ranking)", source)
        self.assertIn("IX0001_LEADERSHIP_COLLECTION_ENABLED", source)
        self.assertIs(LEADERSHIP_COLLECTION_ENABLED, False)


class EnrichedContributionTests(unittest.TestCase):
    def test_index_parser_preserves_provider_order_and_constructs_abs_ranking(self):
        payload = EnrichedPayload({
            "code": "IX0001", "date": "2026/08/24", "time": "09:01:02.123456",
            "ranking": "abs10", "simtrade": False,
            "entries": [
                {"code": "2330", "price": 1000, "reference": 990, "price_chg": 10, "pct_chg": 1.01, "points": 81.5},
                {"code": "2317", "price": 210, "reference": 212, "price_chg": -2, "pct_chg": -0.94, "points": -4.2},
            ],
        })
        result = normalize_index_contribution(payload, "2026-08-24T09:01:02.500000+08:00")
        self.assertEqual(result["recordType"], "IX0001_INDEX_CONTRIBUTION_RAW")
        self.assertEqual(result["ranking"], "abs10")
        self.assertEqual([row["code"] for row in result["entries"]], ["2330", "2317"])
        self.assertEqual(result["entries"][0]["priceChange"], 10.0)
        self.assertEqual(result["qualityStatus"], "PASS")
        self.assertRegex(result["rawPayloadHash"], r"^[a-f0-9]{64}$")
        self.assertEqual(result["formalWeight"], 0)
        self.assertIs(result["executionAuthorized"], False)

    def test_simulated_matching_is_labeled_and_not_recast_as_live(self):
        payload = EnrichedPayload({
            "code": "IX0001", "date": "2026/08/24", "time": "08:59:59.000000",
            "ranking": "positive25", "simtrade": True,
            "entries": [{"code": "2330", "price": 1000, "reference": 990, "price_chg": 10, "pct_chg": 1.01, "points": 81.5}],
        })
        result = normalize_index_contribution(payload, "2026-08-24T08:59:59.100000+08:00")
        self.assertEqual(result["simtradeState"], "SIMULATED_MATCHING")
        self.assertIs(result["simtrade"], True)

    def test_industry_points_invariant_passes_within_explicit_tolerance(self):
        payload = EnrichedPayload({
            "code": "IX0001", "date": "2026/08/24", "time": "09:02:00.000000",
            "simtrade": False, "index_close": 25000, "index_price_chg": 12.35,
            "entries": [{"category": "01", "points": 10.0}, {"category": "02", "points": 2.3}],
        })
        result = normalize_industry_contribution(payload, "2026-08-24T09:02:00.100000+08:00")
        self.assertEqual(result["qualityStatus"], "PASS")
        self.assertAlmostEqual(result["industryPointsSum"], 12.3)
        self.assertAlmostEqual(result["industryInvariantDelta"], 0.05)
        self.assertEqual(result["industryInvariantTolerance"], INDUSTRY_POINTS_TOLERANCE)

    def test_industry_points_invariant_fails_without_rescaling_provider_values(self):
        payload = EnrichedPayload({
            "code": "IX0001", "date": "2026/08/24", "time": "09:02:00.000000",
            "simtrade": False, "index_close": 25000, "index_price_chg": 12.5,
            "entries": [{"category": "01", "points": 8.0}, {"category": "02", "points": 2.0}],
        })
        result = normalize_industry_contribution(payload, "2026-08-24T09:02:00.100000+08:00")
        self.assertEqual(result["qualityStatus"], "QUALITY_INSUFFICIENT")
        self.assertIn("INDUSTRY_SUM_INVARIANT_FAILED", result["qualityReasons"])
        self.assertEqual([row["points"] for row in result["entries"]], [8.0, 2.0])

    def test_empty_leadership_snapshot_is_fail_closed_and_non_directional(self):
        result = leadership_payload(datetime(2026, 8, 24, 20, 0).astimezone())
        self.assertEqual(result["state"], "UNAVAILABLE")
        self.assertEqual(result["sourceMode"], "UNAVAILABLE")
        self.assertIs(result["NOT_A_TRADING_SIGNAL"], True)
        self.assertIs(result["executionAuthorized"], False)


if __name__ == "__main__":
    unittest.main()
