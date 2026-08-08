import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  aggregateForwardBars,
  appendForwardRegistryRecord,
  auditForwardRegistry,
  buildForwardFeatureRow,
  calculateForwardSeverities,
  classifyForwardAttempt,
  contractMonthFromLiveCode,
  FORWARD_ATTEMPT_STATUS,
  predictFrozenModels,
  readForwardRegistry,
  resolveFrozenOutcomes,
} from '../src/v310-forward-operations.mjs';

test('attempt status preserves rejection cause without changing overall Gate semantics', () => {
  assert.equal(classifyForwardAttempt({ accepted: true }), FORWARD_ATTEMPT_STATUS.ACCEPTED);
  assert.equal(classifyForwardAttempt({
    reason: 'opening_window_coverage_failed',
  }), FORWARD_ATTEMPT_STATUS.REJECTED_INCOMPLETE);
  assert.equal(classifyForwardAttempt({
    reason: 'prediction_operational_health_failed',
  }), FORWARD_ATTEMPT_STATUS.REJECTED_OPERATIONAL);
  assert.equal(classifyForwardAttempt({
    reason: 'final_engineering_gate_failed',
    details: { sourceAudit: { hashFailures: 1 } },
  }), FORWARD_ATTEMPT_STATUS.REJECTED_DATA_QUALITY);
  assert.equal(classifyForwardAttempt({
    reason: 'final_engineering_gate_failed',
    details: { registryAudit: { ok: false } },
  }), FORWARD_ATTEMPT_STATUS.CORE_FAILURE);
  assert.equal(classifyForwardAttempt({
    reason: 'final_engineering_gate_failed',
    details: { health: null, predictions: 12, outcomes: 12 },
  }), FORWARD_ATTEMPT_STATUS.REJECTED_OPERATIONAL);
});

function historicalDay(index) {
  const day = String(index + 1).padStart(2, '0');
  const base = 40_000 + index * 10;
  return {
    tradeDate: `2026-06-${day}`,
    session: 'day',
    timeframe: '5m',
    contract: '202608',
    bars: Array.from({ length: 60 }, (_, barIndex) => ({
      open: base + barIndex,
      high: base + barIndex + 3,
      low: base + barIndex - 2,
      close: base + barIndex + 1,
    })),
  };
}

function tick(time, price, volume = 1) {
  return {
    kind: 'futures_tick',
    duplicate: false,
    sequenceGap: 0,
    exchangeTimestamp: `2026-07-31T${time}`,
    payload: {
      date: '2026-07-31',
      time,
      close: price,
      volume,
      simtrade: false,
      _product_family: 'TX',
    },
  };
}

test('forward feature row preserves frozen formulas and live contract month', () => {
  const history = Array.from({ length: 29 }, (_, index) => historicalDay(index));
  const rankHistory = Array.from({ length: 30 }, (_, index) => ({
    tradeDate: `2026-05-${String(index + 1).padStart(2, '0')}`,
    termSpreadBps: index,
    skew25d: index / 100,
    marketOiDeltaPct: (index - 15) / 1_000,
    priorRv20: 0.01 + index / 10_000,
  }));
  const openingBars = [
    { open: 40_400, high: 40_430, low: 40_390, close: 40_420 },
    { open: 40_420, high: 40_450, low: 40_410, close: 40_440 },
    { open: 40_440, high: 40_460, low: 40_430, close: 40_450 },
  ];
  const row = buildForwardFeatureRow({
    tradeDate: '2026-07-31',
    liveContract: 'TXFH6',
    openingBars,
    historicalDays: history,
    rawFactors: {
      factorSourceDate: '2026-07-30',
      termSpreadBps: 25,
      skew25d: 0.2,
      marketOiDeltaPct: 0.005,
    },
    rankHistory,
  });
  assert.equal(contractMonthFromLiveCode('TXFH6', '2026-07-31'), '202608');
  assert.equal(row.contract, '202608');
  assert.equal(row.decisionAvailableAt, '2026-07-31T09:00:00+08:00');
  assert.ok(Number.isFinite(row.gapReturn));
  assert.ok(Number.isFinite(row.prior5dMomentum));
  assert.ok(Number.isFinite(row.priorRv20));
  assert.ok(Number.isFinite(row.h1PriceTermInteraction));
  assert.ok(Number.isFinite(row.h2VolSkewInteraction));
  assert.ok(Number.isFinite(row.h3TrendOiInteraction));
  assert.equal(row.executionAuthorized, false);
});

test('tick bars produce the frozen 60-minute event severities', () => {
  const ticks = [];
  for (let index = 0; index < 15; index += 1) {
    const totalMinutes = 8 * 60 + 45 + index * 5;
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const minute = String(totalMinutes % 60).padStart(2, '0');
    ticks.push(tick(`${hour}:${minute}:01.000000`, 40_000 + index * 10));
    ticks.push(tick(`${hour}:${minute}:59.000000`, 40_005 + index * 10, 2));
  }
  const bars = aggregateForwardBars(ticks);
  const severities = calculateForwardSeverities(bars);
  assert.equal(bars.length, 15);
  assert.equal(severities.anchorPrice, 40_025);
  assert.equal(severities.targetClose, 40_145);
  assert.ok(severities.largeMove60Severity > 0);
  assert.equal(severities.downsideTail60Severity, 0);
  assert.ok(severities.extremeExcursion60Severity > 0);
  assert.ok(severities.volatilityExpansion60Severity > 0);
});

test('all twelve frozen models predict without changing their artifact', () => {
  const artifactPath = path.join(
    process.cwd(), 'data', 'intraday', 'research', 'v3.10-wave3-forward',
    'restricted-frozen-models.json',
  );
  const before = fs.readFileSync(artifactPath);
  const artifact = JSON.parse(before);
  const featureKeys = new Set(artifact.models.flatMap((model) => [
    ...model.priceModel.featureKeys,
    ...model.factorModel.featureKeys,
    ...model.interactionModel.featureKeys,
  ]));
  const row = Object.fromEntries([...featureKeys].map((key) => [key, 0.1]));
  const predictions = predictFrozenModels(artifact, row);
  assert.equal(predictions.length, 12);
  assert.ok(predictions.every((item) => Object.values(item.predictions)
    .every((value) => value >= 0 && value <= 1)));
  assert.deepEqual(fs.readFileSync(artifactPath), before);
});

test('registry is hash chained, sequenced, idempotent and links outcomes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'v310-forward-'));
  const ledger = path.join(temp, 'registry.jsonl');
  const frozen = appendForwardRegistryRecord(ledger, {
    eventType: 'models_frozen',
    idempotencyKey: 'models_frozen',
    recordedAt: '2026-07-30T05:00:00.000Z',
  });
  const prediction = appendForwardRegistryRecord(ledger, {
    eventType: 'prediction',
    idempotencyKey: 'prediction:2026-07-31:H1:largeMove60',
    tradeDate: '2026-07-31',
    modelKey: 'H1:largeMove60',
    recordedAt: '2026-07-31T01:00:01.000Z',
    targetAvailableAt: '2026-07-31T10:00:00+08:00',
  });
  const duplicate = appendForwardRegistryRecord(ledger, {
    eventType: 'prediction',
    idempotencyKey: 'prediction:2026-07-31:H1:largeMove60',
    tradeDate: '2026-07-31',
    modelKey: 'H1:largeMove60',
    recordedAt: '2026-07-31T01:00:02.000Z',
    targetAvailableAt: '2026-07-31T10:00:00+08:00',
  });
  appendForwardRegistryRecord(ledger, {
    eventType: 'outcome',
    idempotencyKey: 'outcome:2026-07-31:H1:largeMove60',
    tradeDate: '2026-07-31',
    modelKey: 'H1:largeMove60',
    recordedAt: '2026-07-31T02:00:01.000Z',
    targetAvailableAt: '2026-07-31T10:00:00+08:00',
    predictionRecordHash: prediction.record.recordHash,
  });
  const rejection = appendForwardRegistryRecord(ledger, {
    eventType: 'day_rejected',
    idempotencyKey: 'day_rejected:2026-08-03:data_failed',
    tradeDate: '2026-08-03',
    reason: 'data_failed',
    recordedAt: '2026-08-03T06:00:00.000Z',
  });
  const records = readForwardRegistry(ledger);
  const audit = auditForwardRegistry(records);
  assert.equal(frozen.appended, true);
  assert.equal(duplicate.appended, false);
  assert.equal(rejection.record.executionAuthorized, false);
  assert.equal(records.length, 4);
  assert.equal(audit.ok, true);
  assert.deepEqual(records.map((record) => record.registrySequence), [1, 2, 3, 4]);
  records[2].predictionRecordHash = 'tampered';
  assert.equal(auditForwardRegistry(records).ok, false);
});

test('frozen outcomes use only frozen event thresholds', () => {
  const artifact = {
    models: [{
      hypothesisId: 'H1',
      targetName: 'largeMove60',
      severityKey: 'largeMove60Severity',
      eventThreshold: 0.01,
    }],
  };
  const outcomes = resolveFrozenOutcomes(artifact, {
    largeMove60Severity: 0.02,
  });
  assert.equal(outcomes[0].actualEvent, 1);
  assert.equal(outcomes[0].eventThreshold, 0.01);
});
