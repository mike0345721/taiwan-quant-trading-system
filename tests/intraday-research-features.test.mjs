import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildIntradayResearchDataset, writeIntradayResearchDataset } from '../src/intraday-research-features.mjs';

function makeDay(tradeDate, contract, volumeBase = 100) {
  const start = Date.parse(`${tradeDate}T00:45:00.000Z`);
  const bars = Array.from({ length: 60 }, (_, index) => {
    const open = 20_000 + index;
    return {
      timestamp: new Date(start + index * 300_000).toISOString(),
      open,
      high: open + 10,
      low: open - 5,
      close: open + 5,
      volume: volumeBase + index,
      complete: true,
    };
  });
  return {
    schemaVersion: '1.0.0', source: 'historical_replay', provider: 'test', product: 'TX', contract,
    session: 'day', timeframe: '5m', tradeDate, bars,
  };
}

function makeAudit(day, state = 'passed_with_scope_warning') {
  return {
    state, generatedAt: `${day.tradeDate}T14:00:00.000Z`, tradeDate: day.tradeDate, contract: day.contract,
    executionAuthorized: false,
    checks: {
      open: { pass: true }, high: { pass: true }, low: { pass: true }, close: { pass: true },
      daySessionCoverage: { pass: true }, contractConsistency: { pass: true },
    },
  };
}

function writeInput(folder, day, state) {
  fs.writeFileSync(path.join(folder, `${day.tradeDate}-day.json`), JSON.stringify(day));
  fs.writeFileSync(path.join(folder, `${day.tradeDate}-audit.json`), JSON.stringify(makeAudit(day, state)));
}

test('builds audited bar and daily features without exposing future fields', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-features-'));
  try {
    writeInput(folder, makeDay('2026-07-14', '202607', 100));
    writeInput(folder, makeDay('2026-07-15', '202608', 200));
    const dataset = buildIntradayResearchDataset(folder);
    assert.equal(dataset.barFeatures.length, 120);
    assert.equal(dataset.dailyFeatures.length, 2);
    assert.equal(dataset.futureLabels.length, 120);
    assert.equal(dataset.quality.counts.includedDays, 2);
    assert.equal(dataset.quality.lookaheadAudit.featureFutureKeyCount, 0);
    assert.equal(dataset.quality.gates.formalResearchReady, false);

    const first = dataset.barFeatures[0];
    assert.equal(first.openingRangeComplete, false);
    assert.equal(first.openingRangeHigh, null);
    assert.equal(first.closeToPreviousBarReturn, null);
    assert.equal(first.rvol20SameSlot, null);
    assert.equal(first.retrievedAt, null);
    assert.equal(first.timeframe, '5m');
    assert.equal(first.executionAuthorized, false);

    const secondDayOpeningComplete = dataset.barFeatures.find((row) => row.tradeDate === '2026-07-15' && row.barIndex === 2);
    assert.equal(secondDayOpeningComplete.openingRangeComplete, true);
    assert.equal(secondDayOpeningComplete.openingRangeHigh, 20_012);
    assert.equal(secondDayOpeningComplete.rvol20SameSlot, null);
    assert.equal(secondDayOpeningComplete.rvol20BaselineMedian, null);
    assert.equal(secondDayOpeningComplete.rvol20SampleDays, 1);
    assert.equal(secondDayOpeningComplete.rvol20Ready, false);
    assert.equal(secondDayOpeningComplete.isContractRollDay, true);
    assert.equal(JSON.stringify(secondDayOpeningComplete).match(/future|horizon|label/gi), null);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('20-day same-slot RVOL remains null through warmup and becomes available on day 21', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-rvol-warmup-'));
  try {
    const start = Date.parse('2026-05-01T00:00:00.000Z');
    for (let index = 0; index <= 20; index += 1) {
      const tradeDate = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      writeInput(folder, makeDay(tradeDate, '202606', 100 + index));
    }
    const dataset = buildIntradayResearchDataset(folder);
    const day20 = dataset.barFeatures.find((row) => row.tradeDate === '2026-05-20' && row.barIndex === 0);
    const day21 = dataset.barFeatures.find((row) => row.tradeDate === '2026-05-21' && row.barIndex === 0);
    assert.equal(day20.rvol20SampleDays, 19);
    assert.equal(day20.rvol20Ready, false);
    assert.equal(day20.rvol20SameSlot, null);
    assert.equal(day21.rvol20SampleDays, 20);
    assert.equal(day21.rvol20Ready, true);
    assert.ok(day21.rvol20SameSlot > 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('future excursion labels are zero-bounded when the whole path stays on one side', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-excursion-labels-'));
  try {
    const day = makeDay('2026-07-14', '202607', 100);
    for (let index = 11; index <= 16; index += 1) {
      day.bars[index] = { ...day.bars[index], open: 21_000, high: 21_010, low: 20_990, close: 21_005 };
    }
    for (let index = 31; index <= 36; index += 1) {
      day.bars[index] = { ...day.bars[index], open: 19_000, high: 19_010, low: 18_990, close: 19_005 };
    }
    writeInput(folder, day);
    const dataset = buildIntradayResearchDataset(folder);
    const favorableOnly = dataset.futureLabels.find((row) => row.barIndex === 10).horizons.m30;
    const adverseOnly = dataset.futureLabels.find((row) => row.barIndex === 30).horizons.m30;
    assert.equal(favorableOnly.maeReturn, 0);
    assert.ok(favorableOnly.mfeReturn > 0);
    assert.equal(adverseOnly.mfeReturn, 0);
    assert.ok(adverseOnly.maeReturn < 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('later bars cannot alter an earlier feature row and future labels remain separate', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-no-lookahead-'));
  try {
    const day = makeDay('2026-07-14', '202607', 100);
    writeInput(folder, day);
    const before = buildIntradayResearchDataset(folder);
    const earlierFeature = before.barFeatures[10];
    day.bars[20] = { ...day.bars[20], high: 99_999, close: 99_990, volume: 99_999 };
    writeInput(folder, day);
    const after = buildIntradayResearchDataset(folder);
    assert.deepEqual(after.barFeatures[10], earlierFeature);
    assert.notDeepEqual(after.futureLabels[10], before.futureLabels[10]);
    assert.equal(after.futureLabels[10].horizons.m30.complete, true);
    assert.equal(after.futureLabels[10].horizons.m30.labelAvailableAt, '2026-07-14T02:10:00.000Z');
    assert.equal(after.futureLabels.at(-1).horizons.m30.closeReturn, null);
    assert.equal(after.futureLabels.at(-1).horizons.m30.reason, 'session_boundary');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('excludes failed audits and writes byte-stable derived files on rerun', () => {
  const archive = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-audit-gate-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'intraday-derived-'));
  try {
    writeInput(archive, makeDay('2026-07-14', '202607', 100));
    writeInput(archive, makeDay('2026-07-15', '202607', 120), 'failed');
    const dataset = buildIntradayResearchDataset(archive);
    assert.equal(dataset.quality.counts.includedDays, 1);
    assert.equal(dataset.quality.counts.excludedDays, 1);
    assert.deepEqual(dataset.quality.excluded[0].errors, ['audit_not_passed']);
    const files = writeIntradayResearchDataset(output, dataset);
    const first = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
    writeIntradayResearchDataset(output, buildIntradayResearchDataset(archive));
    const second = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
    assert.deepEqual(second, first);
    assert.equal(JSON.parse(first.quality).executionAuthorized, false);
  } finally {
    fs.rmSync(archive, { recursive: true, force: true });
    fs.rmSync(output, { recursive: true, force: true });
  }
});
