import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditDuplicateKeys,
  buildCanonicalFeatureRows,
  factorDefinitions,
  stableDigest,
  summarizeCanonicalQuality,
} from '../src/phase-a-canonical.mjs';

function dateAt(index) {
  const cursor = new Date('2026-01-01T00:00:00Z');
  cursor.setUTCDate(cursor.getUTCDate() + index);
  return cursor.toISOString().slice(0, 10);
}

function fixture() {
  const marketRows = Array.from({ length: 64 }, (_, index) => ({
    trade_date: dateAt(index),
    tx_contract: '202601',
    tx_close: 20000 + index,
    twii_change_pct: index / 100,
    tx_change_pct: index / 200,
    tx_volume: 1000 + index,
    tx_open_interest: 50000 + index,
    listed_advance: 600,
    listed_decline: 400,
    listed_limit_up: 10,
    listed_limit_down: 5,
    otc_advance: 300,
    otc_decline: 200,
    otc_limit_up: 6,
    otc_limit_down: 3,
  }));
  const spotRows = marketRows.map((row, index) => ({
    trade_date: row.trade_date,
    foreign_net_e: index + 1,
    trust_net_e: index % 2 ? -1 : 1,
    dealer_total_net_e: 2,
  }));
  const globalRows = [
    { symbol: 'NDX', trade_date: '2026-01-01', return_pct: 1 },
    { symbol: 'NDX', trade_date: '2026-01-03', return_pct: 2 },
  ];
  return {
    marketRows,
    spotRows,
    futuresRows: [],
    futuresOiRows: [],
    largeRows: [],
    basisRows: [],
    optionsRows: [],
    optionVolRows: [],
    optionTermRows: [],
    globalRows,
    macroRows: [
      { series_key: 'VIXCLS', observation_date: '2026-01-01', value: 15 },
    ],
  };
}

const featureSpec = {
  featureVersion: 'test-v1',
  groups: [
    {
      factorGroup: 'Cash',
      sourceTable: 'spot_institutional_daily',
      baseFeatures: [
        {
          factorId: 'cash_foreign_net',
          columns: ['foreign_net_e'],
          transforms: ['raw', 'delta_1d', 'sum_or_change_3d', 'past_only_z60'],
        },
      ],
    },
    {
      factorGroup: 'CrossMarket',
      sourceTable: 'global_market_daily',
      baseFeatures: [
        {
          factorId: 'cross_ndx_return',
          symbol: 'NDX',
          columns: ['return_pct'],
          transforms: ['raw', 'sum_or_change_3d'],
        },
      ],
      additionalSources: [
        { table: 'macro_observations', factorIds: ['VIXCLS'] },
      ],
    },
  ],
};

test('Canonical日資料只使用前一交易日，且past-only z60不含當前值', () => {
  const rows = buildCanonicalFeatureRows(fixture(), featureSpec);
  const raw = rows.find(
    (row) => row.decisionTradeDate === dateAt(1) && row.factorId === 'cash_foreign_net',
  );
  assert.equal(raw.sourceTradeDate, dateAt(0));
  assert.equal(raw.value, 1);
  assert.ok(Date.parse(raw.availableAt) < Date.parse(raw.decisionAt));

  const delta = rows.find(
    (row) => row.decisionTradeDate === dateAt(2)
      && row.factorId === 'cash_foreign_net__delta_1d',
  );
  assert.equal(delta.value, 1);

  const z60 = rows.find(
    (row) => row.decisionTradeDate === dateAt(62)
      && row.factorId === 'cash_foreign_net__past_only_z60',
  );
  assert.equal(z60.qualityState, 'PASS');
  const expectedMean = (2 + 61) / 2;
  const prior = Array.from({ length: 60 }, (_, index) => index + 2);
  const variance = prior.reduce((sum, value) => sum + (value - expectedMean) ** 2, 0) / 60;
  assert.ok(Math.abs(z60.value - ((62 - expectedMean) / Math.sqrt(variance))) < 1e-12);
});

test('外部市場相同來源日不會在滾動視窗重複計功', () => {
  const rows = buildCanonicalFeatureRows(fixture(), featureSpec);
  const repeated = rows.filter(
    (row) => row.factorId === 'cross_ndx_return' && row.sourceTradeDate === '2026-01-03',
  );
  assert.ok(repeated.length > 1);
  const rolling = rows.filter(
    (row) => row.factorId === 'cross_ndx_return__sum_or_change_3d',
  );
  assert.equal(rolling.some((row) => row.qualityState === 'PASS'), false);
});

test('沒有發布時間的Macro保持Blocked，摘要不可將其視為可交易資料', () => {
  const rows = buildCanonicalFeatureRows(fixture(), featureSpec);
  const definitions = factorDefinitions(featureSpec);
  const quality = summarizeCanonicalQuality(rows, definitions);
  const macro = quality.find((row) => row.factorId === 'VIXCLS');
  assert.equal(macro.qualityState, 'BLOCKED');
  assert.equal(macro.validObservations, 0);
});

test('相同Snapshot輸入可產生相同資料Digest，重複鍵可被偵測', () => {
  const raw = fixture();
  const first = buildCanonicalFeatureRows(raw, featureSpec);
  const second = buildCanonicalFeatureRows(raw, featureSpec);
  assert.equal(stableDigest(first), stableDigest(second));
  raw.marketRows.push({ ...raw.marketRows[0] });
  const duplicate = auditDuplicateKeys(raw).find((row) => row.table === 'market_daily');
  assert.equal(duplicate.duplicateKeys, 1);
});
