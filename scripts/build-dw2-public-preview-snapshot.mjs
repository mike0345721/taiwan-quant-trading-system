import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { clearTxChartLedgerCache, loadTxDecisionChart } from '../src/dashboard-tx-chart-source.mjs';
import {
  PUBLIC_PREVIEW_TIMEFRAMES,
  createPublicPreviewSnapshot,
  writePublicPreviewSnapshot,
} from '../src/dashboard-public-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`PUBLIC_PREVIEW_ARGUMENT_REQUIRED:${name}`);
  return value;
}

function atDayClose(tradeDate) {
  return `${tradeDate}T13:45:00+08:00`;
}

function sessionFor(chart) {
  if ((chart?.sessionCoverage?.day?.eventCount || 0) > 0) return 'DAY';
  return 'NIGHT';
}

function candidateState(chart) {
  const dayCoverageReachesClose = chart.tradeDate && chart.sessionCoverage?.day?.lastEventTime
    && Date.parse(chart.sessionCoverage.day.lastEventTime) >= Date.parse(`${chart.tradeDate}T13:44:00+08:00`);
  if (chart.bars?.length && chart.coverageState === 'COMPLETE'
    && chart.contractConsistencyState === 'MATCH' && dayCoverageReachesClose) return 'COMPLETE';
  if (chart.bars?.length) return 'PARTIAL';
  return 'UNAVAILABLE';
}

export function selectPreviewTradeDate({ calendar, dataRoot, cacheRoot, explicitTradeDate = null, asOf = null }) {
  const dates = explicitTradeDate
    ? [explicitTradeDate]
    : [...calendar.tradingDates].sort().reverse();
  let partial = null;
  for (const tradeDate of dates) {
    const cutoff = asOf || atDayClose(tradeDate);
    const chart = loadTxDecisionChart({
      dataRoot, cacheRoot, calendar, timeframe: '1D', mode: 'REPLAY', tradeDate, asOf: cutoff,
    });
    const state = candidateState(chart);
    if (state === 'COMPLETE') return Object.freeze({ tradeDate, asOf: cutoff, chart, selectionState: state });
    if (!partial && state === 'PARTIAL') partial = Object.freeze({ tradeDate, asOf: cutoff, chart, selectionState: state });
  }
  if (partial) return partial;
  throw new Error('PUBLIC_PREVIEW_NO_LEGAL_TX_DATA');
}

export function buildPreviewArtifact({ calendar, dataRoot, cacheRoot, outputDir, tradeDate = null, asOf = null }) {
  const selected = selectPreviewTradeDate({ calendar, dataRoot, cacheRoot, explicitTradeDate: tradeDate, asOf });
  const session = sessionFor(selected.chart);
  const charts = Object.fromEntries(PUBLIC_PREVIEW_TIMEFRAMES.map((timeframe) => [timeframe,
    timeframe === '1D'
      ? selected.chart
      : loadTxDecisionChart({
        dataRoot, cacheRoot, calendar, timeframe, mode: 'REPLAY', tradeDate: selected.tradeDate,
        session, actualContract: selected.chart.actualContract, asOf: selected.asOf,
      }),
  ]));
  const snapshot = createPublicPreviewSnapshot({ charts, generatedAt: selected.asOf });
  const files = writePublicPreviewSnapshot(path.join(outputDir, snapshot.snapshotId), snapshot);
  return Object.freeze({ selected, snapshot, files });
}

async function main() {
  const dataRoot = path.resolve(required('--data-root'));
  const outputDir = path.resolve(required('--output-dir'));
  const calendarPath = path.resolve(option('--calendar', path.join(root, 'config', 'taifex-official-calendar-2026.json')));
  if (!fs.existsSync(dataRoot)) throw new Error('PUBLIC_PREVIEW_DATA_ROOT_MISSING');
  const calendar = loadGovernedTradingCalendar(calendarPath);
  const result = buildPreviewArtifact({
    calendar,
    dataRoot,
    cacheRoot: path.join(outputDir, '.derived-cache'),
    outputDir,
    tradeDate: option('--trade-date'),
    asOf: option('--as-of'),
  });
  clearTxChartLedgerCache();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    PREVIEW_DATA_MODE: 'FROZEN_SNAPSHOT',
    selectionRule: 'LATEST_GOVERNED_DATA_AVAILABILITY_COMPLETE_FIRST_NO_OUTCOME_ACCESS',
    selectionState: result.selected.selectionState,
    snapshotId: result.snapshot.snapshotId,
    tradeDate: result.snapshot.tradeDate,
    actualContract: result.snapshot.actualContract,
    snapshotPath: result.files.snapshotPath,
    manifestPath: result.files.manifestPath,
    snapshotFileHash: result.files.snapshotFileHash,
    manifestFileHash: result.files.manifestFileHash,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  });
}
