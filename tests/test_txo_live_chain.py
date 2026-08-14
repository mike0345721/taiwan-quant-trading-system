import json
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "broker"))

from txo_live_chain import (  # noqa: E402
    contract_metadata,
    load_activation_config,
    resolve_session_trade_date,
    select_governed_universe,
    select_nearest_expiry_contracts,
)


class Contract:
    def __init__(self, code, expiry, strike, right):
        self.code = code
        self.delivery_date = expiry
        self.strike_price = strike
        self.option_right = right


class Snapshot:
    def __init__(self, code, bid=10, ask=11):
        self.code = code
        self.buy_price = bid
        self.sell_price = ask


class TxoLiveChainTests(unittest.TestCase):
    def test_default_off_needs_no_config(self):
        self.assertEqual(load_activation_config(False, None)["state"], "STOPPED_EXPECTED")

    def test_activation_requires_immutable_owner_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({
                "schemaVersion": "txo-live-chain-activation-v1",
                "productionActivationApproved": True,
                "ownerApprovalHash": "a" * 64,
                "researchOnly": True,
                "formalWeight": 0,
                "executionAuthorized": False,
                "orderRoutesEnabled": False,
                "universe": {
                    "method": "GOVERNED_NEAR_MARKET_LIQUID_PAIRS",
                    "sourceRoot": "TXO",
                    "expiryPolicy": "NEAREST_MONTHLY",
                    "ownerApprovedMaxContracts": 10,
                },
            }), encoding="utf-8")
            self.assertTrue(load_activation_config(True, path)["enabled"])
            value = json.loads(path.read_text(encoding="utf-8"))
            value["productionActivationApproved"] = False
            path.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "NOT_APPROVED"):
                load_activation_config(True, path)

    def test_selection_is_nearest_expiry_liquid_pairs_and_bounded(self):
        contracts = [
            Contract("TXO45800H6", "2026-08-19", 45800, "C"),
            Contract("TXO45800T6", "2026-08-19", 45800, "P"),
            Contract("TXO45900H6", "2026-08-19", 45900, "C"),
            Contract("TXO45900T6", "2026-08-19", 45900, "P"),
            Contract("TXO45900I6", "2026-09-16", 45900, "C"),
        ]
        nearest = select_nearest_expiry_contracts(contracts, date(2026, 8, 14))
        snapshots = [Snapshot(item.code) for item in nearest]
        selected = select_governed_universe(nearest, snapshots, 45880, 2)
        self.assertEqual([item.code for item in selected], ["TXO45900H6", "TXO45900T6"])
        self.assertEqual(contract_metadata(selected[0])["expiryClass"], "MONTHLY")

    def test_session_trade_date_uses_governed_calendar(self):
        calendar = {"tradingDates": ["2026-08-14", "2026-08-17"]}
        self.assertEqual(resolve_session_trade_date(datetime(2026, 8, 14, 9), calendar), ("DAY", "2026-08-14"))
        self.assertEqual(resolve_session_trade_date(datetime(2026, 8, 14, 19), calendar), ("NIGHT", "2026-08-17"))
        self.assertEqual(resolve_session_trade_date(datetime(2026, 8, 17, 2), calendar), ("NIGHT", "2026-08-17"))


if __name__ == "__main__":
    unittest.main()
