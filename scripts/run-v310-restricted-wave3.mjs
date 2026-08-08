import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRICE_BASELINE_KEYS,
  EVENT_TARGETS,
  HYPOTHESES,
  buildRestrictedBaselineRows,
  addHypothesisFeatures,
  eventWalkForward,
  blockPermutationEventTest,
  applyHolmFamily,
  classifyRestrictedStudy,
} from '../src/v310-restricted-wave3.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const protocolPath = path.join(root, 'docs', 'research', 'V3_10_RESTRICTED_WAVE3_PROTOCOL.md');
const modulePath = path.join(root, 'src', 'v310-restricted-wave3.mjs');
const scriptPath = fileURLToPath(import.meta.url);
const archiveDir = path.join(root, 'data', 'intraday', 'archive');
const alignedPath = path.join(
  root, 'data', 'intraday', 'research', 'v3.10-factor-impact', 'aligned-daily.ndjson',
);
const outputDir = path.join(
  root, 'data', 'intraday', 'research', 'v3.10-restricted-wave3',
);
const forwardDir = path.join(
  root, 'data', 'intraday', 'research', 'v3.10-wave3-forward',
);
const frozenSpecPath = path.join(forwardDir, 'restricted-frozen-spec.json');
const registryPath = path.join(forwardDir, 'restricted-forward-registry.jsonl');

function sha256Content(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(target) {
  return sha256Content(fs.readFileSync(target));
}

function readNdjson(target) {
  return fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeNdjson(target, rows) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function taipeiDate(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function nextCalendarDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function compactStudy(study) {
  const { walkForward } = study;
  return {
    hypothesisId: study.hypothesisId,
    targetName: study.targetName,
    primaryTarget: study.primaryTarget,
    usableDays: walkForward.usableDays,
    oosDays: walkForward.metrics.interaction.samples,
    folds: walkForward.folds.length,
    price: walkForward.metrics.price,
    pricePlusFactor: walkForward.metrics.factor,
    pricePlusFactorInteraction: walkForward.metrics.interaction,
    factorRelativeBrierImprovement: walkForward.factorRelativeBrierImprovement,
    interactionRelativeBrierImprovement: walkForward.relativeBrierImprovement,
    positiveFoldShare: walkForward.positiveFoldShare,
    expectedSignFoldShare: walkForward.expectedSignFoldShare,
    foldEvidence: walkForward.folds,
    permutation: study.permutation,
    multipleTesting: study.multipleTesting,
    gates: study.gates,
    verdict: study.verdict,
  };
}

const generatedAt = new Date().toISOString();
const alignedRows = readNdjson(alignedPath);
const historicalDates = new Set(alignedRows.map((row) => row.tradeDate));
const days = [...historicalDates].sort().map((tradeDate) => {
  const dayPath = path.join(archiveDir, `${tradeDate}-day.json`);
  const auditPath = path.join(archiveDir, `${tradeDate}-audit.json`);
  if (!fs.existsSync(dayPath) || !fs.existsSync(auditPath)) {
    throw new Error(`historical_input_missing:${tradeDate}`);
  }
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const requiredChecks = ['daySessionCoverage', 'contractConsistency', 'open', 'high', 'low', 'close'];
  if (!requiredChecks.every((key) => audit.checks?.[key]?.pass === true)) {
    throw new Error(`historical_audit_not_passed:${tradeDate}`);
  }
  return JSON.parse(fs.readFileSync(dayPath, 'utf8'));
});

const baseRows = buildRestrictedBaselineRows(days, alignedRows);
const rows = addHypothesisFeatures(baseRows);
const coverage = Object.fromEntries([
  ...PRICE_BASELINE_KEYS,
  'termSpreadBpsPastRank',
  'skew25dPastRank',
  'marketOiDeltaPctPastRank',
  'priorRv20PastRank',
].map((key) => [
  key,
  rows.filter((row) => row[key] !== null && Number.isFinite(Number(row[key]))).length,
]));
const timeViolations = rows.filter((row) =>
  !row.factorSourceDate
  || row.factorSourceDate >= row.tradeDate
  || Number.isNaN(Date.parse(row.decisionAvailableAt)));

const studies = [];
let seed = 20260730;
for (const hypothesis of HYPOTHESES) {
  for (const targetName of Object.keys(EVENT_TARGETS)) {
    const walkForward = eventWalkForward(rows, hypothesis, targetName);
    const permutation = blockPermutationEventTest(
      rows,
      hypothesis,
      targetName,
      walkForward.relativeBrierImprovement,
      { iterations: 1_000, blockSize: 5, seed },
    );
    seed += 1;
    studies.push({
      hypothesisId: hypothesis.id,
      targetName,
      primaryTarget: targetName === hypothesis.primaryTarget,
      walkForward,
      permutation,
    });
  }
}

applyHolmFamily(studies);
for (const study of studies) {
  const hypothesis = HYPOTHESES.find((item) => item.id === study.hypothesisId);
  Object.assign(study, classifyRestrictedStudy(study, hypothesis));
}

const protocolSha256 = sha256File(protocolPath);
const implementationSha256 = sha256Content(
  `${sha256File(modulePath)}:${sha256File(scriptPath)}`,
);
const historicalLastDate = rows.at(-1)?.tradeDate ?? null;
const report = {
  schemaVersion: 'v3.10-restricted-wave3-report-v1',
  generatedAt,
  protocolSha256,
  implementationSha256,
  ownerDecisionAccepted: true,
  evidenceRole: 'historical_discovery_only',
  historicalDataConsumed: true,
  untouchedHoldoutExists: false,
  researchOnly: true,
  executionAuthorized: false,
  formalWeightsChanged: false,
  productized: false,
  dataQuality: {
    days: rows.length,
    firstDate: rows[0]?.tradeDate ?? null,
    lastDate: historicalLastDate,
    timeViolations: timeViolations.length,
    coverage,
    strictPriceOnlyKeys: PRICE_BASELINE_KEYS,
    excludedFromStrictPriceOnly: ['closeVsVwapReturn', 'logOpeningVolume'],
  },
  model: {
    type: 'ridge_linear_probability',
    lambda: 1,
    minimumTrainingDays: 60,
    purgeDays: 1,
    testWindowDays: 12,
    probabilityClipped: true,
  },
  multipleTesting: {
    method: 'Holm',
    familySize: studies.length,
    alpha: 0.05,
    permutationsPerStudy: 1_000,
    blockSizeDays: 5,
  },
  studies: studies.map(compactStudy),
  primaryHypotheses: studies.filter((study) => study.primaryTarget).map((study) => ({
    hypothesisId: study.hypothesisId,
    targetName: study.targetName,
    verdict: study.verdict,
    gates: study.gates,
  })),
  overallDecision: studies.some(
    (study) => study.primaryTarget
      && study.verdict === 'historical_discovery_requires_frozen_forward',
  )
    ? 'historical_discovery_only_wait_for_frozen_forward'
    : 'no_primary_hypothesis_supported',
};

const baselineAudit = {
  schemaVersion: 'v3.10-price-baseline-audit-v1',
  generatedAt,
  protocolSha256,
  historicalDays: rows.length,
  firstDate: rows[0]?.tradeDate ?? null,
  lastDate: historicalLastDate,
  coverage,
  availableAtRule: '09:00 Asia/Taipei after barIndex 2 completes',
  timeViolations: timeViolations.length,
  strictPriceOnlyKeys: PRICE_BASELINE_KEYS,
  previousBaseline: {
    keys: ['openingReturn', 'openingRangeReturn', 'closeVsVwapReturn', 'logOpeningVolume'],
    coverageDays: 135,
    strictPriceOnly: false,
    reasons: [
      'closeVsVwapReturn uses OHLCV approximate VWAP',
      'logOpeningVolume is volume rather than price',
      'gap, slow trend, prior realized volatility, prior range, opening location and path efficiency were absent',
    ],
  },
  researchOnly: true,
  executionAuthorized: false,
};

fs.mkdirSync(outputDir, { recursive: true });
writeJson(path.join(outputDir, 'price-baseline-audit.json'), baselineAudit);
writeNdjson(path.join(outputDir, 'aligned-discovery.ndjson'), rows);
writeJson(path.join(outputDir, 'restricted-wave3-report.json'), report);

const reportLines = [
  '# V3.10 限制式第三輪歷史Discovery報告',
  '',
  `> 產生時間：${generatedAt}`,
  '> 證據定位：historical discovery only；135日全部已檢視，沒有untouched holdout。',
  '> 正式權重：0；不得產品化。',
  '',
  '## Price-only Baseline Audit',
  '',
  `- 歷史日數：${rows.length}`,
  `- 時間違規：${timeViolations.length}`,
  `- 嚴格Price-only特徵：${PRICE_BASELINE_KEYS.join('、')}`,
  '- 原本的closeVsVwapReturn與logOpeningVolume不再算作嚴格Price-only。',
  '',
  '## 三個Primary Hypotheses',
  '',
  '| 假說 | Primary target | OOS日 | Brier改善 | 正向fold | Holm p/門檻 | 結論 |',
  '|---|---|---:|---:|---:|---:|---|',
];
for (const study of studies.filter((item) => item.primaryTarget)) {
  reportLines.push(
    `| ${study.hypothesisId} | ${study.targetName} | ${study.walkForward.metrics.interaction.samples}`
    + ` | ${((study.walkForward.relativeBrierImprovement ?? 0) * 100).toFixed(2)}%`
    + ` | ${((study.walkForward.positiveFoldShare ?? 0) * 100).toFixed(1)}%`
    + ` | ${study.permutation.pValueOneSided.toFixed(4)}/${study.multipleTesting.threshold.toFixed(4)}`
    + ` | ${study.verdict} |`,
  );
}
reportLines.push(
  '',
  '## 整體判決',
  '',
  `**${report.overallDecision}**`,
  '',
  '即使歷史Discovery出現改善，也只能等待凍結後forward evidence，不能調整正式權重。',
  '',
);
fs.writeFileSync(path.join(outputDir, 'REPORT.md'), reportLines.join('\n'), 'utf8');

const frozenSpec = {
  schemaVersion: 'v3.10-restricted-forward-spec-v1',
  frozenAt: generatedAt,
  protocolSha256,
  implementationSha256,
  historicalLastDate,
  historicalDataConsumedThrough: historicalLastDate,
  earliestEligibleTradeDate: nextCalendarDate(taipeiDate(generatedAt)),
  startRule: 'first completed audited trading day on or after earliestEligibleTradeDate',
  smokeTestDays: 30,
  promotionAuthorized: false,
  priceBaselineKeys: PRICE_BASELINE_KEYS,
  hypotheses: HYPOTHESES,
  targets: EVENT_TARGETS,
  researchOnly: true,
  executionAuthorized: false,
};
const frozenSpecText = `${JSON.stringify(frozenSpec, null, 2)}\n`;
const frozenSpecSha256 = sha256Content(frozenSpecText);

fs.mkdirSync(forwardDir, { recursive: true });
if (fs.existsSync(frozenSpecPath)) {
  const existing = fs.readFileSync(frozenSpecPath, 'utf8');
  const parsed = JSON.parse(existing);
  if (parsed.protocolSha256 !== protocolSha256
    || parsed.implementationSha256 !== implementationSha256) {
    throw new Error('frozen_forward_spec_conflict');
  }
} else {
  fs.writeFileSync(frozenSpecPath, frozenSpecText, 'utf8');
}

const registryRecord = {
  schemaVersion: 'v3.10-restricted-forward-registry-v1',
  eventType: 'registry_frozen',
  recordedAt: generatedAt,
  frozenSpecSha256,
  protocolSha256,
  implementationSha256,
  earliestEligibleTradeDate: frozenSpec.earliestEligibleTradeDate,
  historicalLastDate,
  acceptedCleanDays: 0,
  status: 'FROZEN_WAITING_NEW_UNSEEN_DAY',
  previousRecordHash: null,
  researchOnly: true,
  executionAuthorized: false,
};
registryRecord.recordHash = sha256Content(JSON.stringify(registryRecord));
if (!fs.existsSync(registryPath)) {
  fs.writeFileSync(registryPath, `${JSON.stringify(registryRecord)}\n`, 'utf8');
}

console.log(JSON.stringify({
  outputDir,
  days: rows.length,
  timeViolations: timeViolations.length,
  studies: studies.length,
  primary: report.primaryHypotheses,
  overallDecision: report.overallDecision,
  frozenSpecPath,
  registryPath,
  earliestEligibleTradeDate: frozenSpec.earliestEligibleTradeDate,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));
