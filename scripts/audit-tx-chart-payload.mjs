import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config } from '../src/config.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { loadTxDecisionChart } from '../src/dashboard-tx-chart-source.mjs';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

const timeframe = argument('--timeframe', '5m');
const mode = argument('--mode', 'LIVE');
const tradeDate = argument('--trade-date');
const session = argument('--session');
const actualContract = argument('--actual-contract');
const asOf = argument('--as-of');
const dataRoot = path.resolve(process.env.TX_CHART_DATA_ROOT || config.dataDir);
const cacheRoot = path.resolve(process.env.TX_CHART_CACHE_ROOT || path.join(config.dataDir, 'dashboard-chart-cache'));
const calendarPath = path.join(config.appRoot, 'config', 'taifex-official-calendar-2026.json');
const exceptionPath = path.join(config.appRoot, 'data', 'market-state', 'forward-shadow', 'governance', 'taifex-official-calendar-exception.json');
const calendar = loadGovernedTradingCalendar(calendarPath, fs.existsSync(exceptionPath) ? exceptionPath : null);

const chart = loadTxDecisionChart({
  dataRoot,
  cacheRoot,
  calendar,
  timeframe,
  mode,
  tradeDate,
  session,
  actualContract,
  asOf,
});

const bars = Array.isArray(chart?.bars) ? chart.bars : [];
const seen = new Set();
const duplicateTimes = [];
const nonIncreasing = [];
const invalidOhlc = [];
const invalidVolume = [];
let previousMs = Number.NEGATIVE_INFINITY;

for (let index = 0; index < bars.length; index += 1) {
  const bar = bars[index] || {};
  const ms = Date.parse(bar.time);
  if (seen.has(bar.time)) duplicateTimes.push({ index, time: bar.time });
  seen.add(bar.time);
  if (!Number.isFinite(ms) || ms <= previousMs) nonIncreasing.push({ index, time: bar.time });
  if (Number.isFinite(ms)) previousMs = ms;
  if (![bar.open, bar.high, bar.low, bar.close].every(finite)
    || Number(bar.high) < Number(bar.low)
    || Number(bar.open) > Number(bar.high)
    || Number(bar.open) < Number(bar.low)
    || Number(bar.close) > Number(bar.high)
    || Number(bar.close) < Number(bar.low)) {
    invalidOhlc.push({ index, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  }
  if (!finite(bar.volume) || Number(bar.volume) < 0) invalidVolume.push({ index, time: bar.time, volume: bar.volume });
}

const frontendEligibleCandles = bars.filter((bar) => Number.isFinite(Date.parse(bar.time))
  && [bar.open, bar.high, bar.low, bar.close].every(finite));
const frontendEligibleVolumes = bars.filter((bar) => Number.isFinite(Date.parse(bar.time)) && finite(bar.volume));
const visualizable = ['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(chart?.status) && bars.length > 0;

const report = {
  schemaVersion: 'cru45-tx-chart-payload-audit-v1',
  request: { timeframe, mode, tradeDate, session, actualContract, asOf },
  dataRoot,
  chart: {
    status: chart?.status || null,
    reason: chart?.reason || null,
    tradeDate: chart?.tradeDate || null,
    session: chart?.session || null,
    sessionId: chart?.sessionId || null,
    actualContract: chart?.actualContract || null,
    contractMonth: chart?.contractMonth || null,
    availableAt: chart?.availableAt || null,
    qualityStatus: chart?.qualityStatus || null,
    lastPrice: chart?.lastPrice ?? null,
    sourceLedgerDates: chart?.sourceLedgerDates || [],
  },
  bars: {
    count: bars.length,
    frontendEligibleCandles: frontendEligibleCandles.length,
    frontendEligibleVolumes: frontendEligibleVolumes.length,
    firstTime: bars[0]?.time || null,
    lastTime: bars.at(-1)?.time || null,
    duplicateTimestampCount: duplicateTimes.length,
    nonIncreasingTimestampCount: nonIncreasing.length,
    invalidOhlcCount: invalidOhlc.length,
    invalidVolumeCount: invalidVolume.length,
    duplicateExamples: duplicateTimes.slice(0, 5),
    nonIncreasingExamples: nonIncreasing.slice(0, 5),
    invalidOhlcExamples: invalidOhlc.slice(0, 5),
    invalidVolumeExamples: invalidVolume.slice(0, 5),
  },
  frontendExpectation: {
    visualizable,
    shouldCallSetData: visualizable,
    shouldHaveVisibleCandles: visualizable && frontendEligibleCandles.length > 0,
  },
  verdict: !visualizable
    ? 'PAYLOAD_NOT_VISUALIZABLE'
    : frontendEligibleCandles.length !== bars.length || duplicateTimes.length || nonIncreasing.length || invalidOhlc.length
      ? 'PAYLOAD_DATA_BLOCKER'
      : 'PAYLOAD_READY_FOR_BROWSER_RENDER_AUDIT',
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict === 'PAYLOAD_DATA_BLOCKER') process.exitCode = 2;
