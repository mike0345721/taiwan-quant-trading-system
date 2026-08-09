from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

from market_state_collection import load_market_state_collection_config, select_txo_contracts


class Info:
    def __init__(self, code, strike, right, delivery_date):
        self.code = code
        self.strike_price = strike
        self.option_right = right
        self.delivery_date = delivery_date
        self.delivery_month = delivery_date.strftime('%Y%m')
        self.underlying_code = 'IX0001'


class MarketStateCollectionTests(unittest.TestCase):
    def test_missing_config_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            config = load_market_state_collection_config(Path(directory) / 'missing.json')
        self.assertFalse(config['enabled'])
        self.assertFalse(config['leadership']['enabled'])
        self.assertFalse(config['options']['enabled'])

    def test_option_selection_is_bounded_pair_complete_and_nearest_expiry_first(self):
        infos = []
        for expiry in (date(2026, 8, 12), date(2026, 8, 19), date(2026, 9, 16)):
            for strike in range(33000, 34100, 100):
                infos.append(Info(f'C-{expiry}-{strike}', strike, 'C', expiry))
                infos.append(Info(f'P-{expiry}-{strike}', strike, 'P', expiry))
        selected = select_txo_contracts(
            infos,
            underlying_price=33500,
            today=date(2026, 8, 9),
            expiry_count=2,
            strikes_per_side=2,
        )
        self.assertEqual({row['deliveryDate'] for row in selected}, {'2026-08-12', '2026-08-19'})
        self.assertEqual(len(selected), 20)  # 5 strikes x 2 rights x 2 expiries
        for expiry in ('2026-08-12', '2026-08-19'):
            rows = [row for row in selected if row['deliveryDate'] == expiry]
            strikes = {row['strikePrice'] for row in rows}
            self.assertEqual(len(strikes), 5)
            for strike in strikes:
                self.assertEqual({row['optionRight'] for row in rows if row['strikePrice'] == strike}, {'C', 'P'})

    def test_incomplete_strike_is_excluded_and_next_pair_complete_strike_is_used(self):
        expiry = date(2026, 8, 12)
        infos = []
        for strike in (33200, 33300, 33400, 33500, 33600, 33700):
            infos.append(Info(f'C-{strike}', strike, 'C', expiry))
            if strike != 33500:
                infos.append(Info(f'P-{strike}', strike, 'P', expiry))
        selected = select_txo_contracts(
            infos,
            underlying_price=33500,
            today=date(2026, 8, 9),
            expiry_count=1,
            strikes_per_side=2,
        )
        selected_strikes = {row['strikePrice'] for row in selected}
        self.assertNotIn(33500.0, selected_strikes)
        self.assertEqual(len(selected_strikes), 5)
        self.assertEqual(len(selected), 10)
        for strike in selected_strikes:
            self.assertEqual({row['optionRight'] for row in selected if row['strikePrice'] == strike}, {'C', 'P'})

    def test_invalid_underlying_produces_no_option_subscriptions(self):
        self.assertEqual(select_txo_contracts([], underlying_price=0, today=date.today()), [])


if __name__ == '__main__':
    unittest.main()
