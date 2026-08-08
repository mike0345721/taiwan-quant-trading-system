import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addPastOnlyPercentileRank,
  applyHolmToPermutation,
  blockPermutationTest,
  classifyRobustnessStudy,
  purgedWalkForward,
} from '../src/intraday-factor-robustness.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inputDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-factor-impact');
const outputDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-factor-robustness');
const inputPath = path.join(inputDir, 'aligned-daily.ndjson');
const firstReportPath = path.join(inputDir, 'factor-impact-report.json');
const protocolPath = path.join(root, 'docs', 'research', 'V3_10_FACTOR_ROBUSTNESS_PROTOCOL.md');
const baselineKeys = [
  'openingReturn',
  'openingRangeReturn',
  'closeVsVwapReturn',
  'logOpeningVolume',
];
const factors = [
  ['openingRvol20', '09:00同時段20日RVOL', 'intraday_volume'],
  ['foreignNetDeltaPctOi', '前日外資期貨淨部位變化／近月OI', 'futures_positioning'],
  ['marketOiDeltaPct', '前日近月市場OI變化率', 'futures_positioning'],
  ['maxPainDistancePct', '前日有效契約Max Pain距TX收盤', 'option_structure'],
  ['wallAsymmetryPct', '前日Call／Put Wall距離不對稱', 'option_structure'],
  ['atmIv', '前日最近可用到期ATM IV', 'volatility'],
  ['skew25d', '前日最近可用到期25D Skew', 'volatility'],
  ['basisBps', '前日期現貨收盤基差bps', 'basis_term'],
  ['termSpreadBps', '前日近次月價差bps', 'basis_term'],
].map(([key, label, group]) => ({ key, label, group, rankKey: `${key}PastRank` }));
const targets = ['return30', 'return60', 'return120', 'excursion30', 'excursion60', 'excursion120'];

function sha256(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function readNdjson(target) {
  return fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function factorVerdict(studies) {
  const verdicts = new Set(studies.map((study) => study.verdict));
  if (verdicts.has('historical_robustness_signal_requires_forward')) {
    return 'historical_robustness_signal_requires_forward';
  }
  if (verdicts.has('descriptive_robustness_only')) return 'descriptive_robustness_only';
  if ([...verdicts].every((verdict) => verdict === 'insufficient_oos')) return 'insufficient_oos';
  return 'not_supported_or_unstable';
}

const sourceRows = readNdjson(inputPath)
  .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
const firstReport = JSON.parse(fs.readFileSync(firstReportPath, 'utf8'));
let rankedRows = sourceRows;
for (const factor of factors) {
  rankedRows = addPastOnlyPercentileRank(rankedRows, factor.key, {
    outputKey: factor.rankKey,
    minimumHistory: 20,
  });
}

const timeViolations = rankedRows.filter((row) =>
  !row.factorSourceDate || row.factorSourceDate >= row.tradeDate);
const studies = [];
for (let factorIndex = 0; factorIndex < factors.length; factorIndex += 1) {
  const factor = factors[factorIndex];
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const targetKey = targets[targetIndex];
    const eligibleRows = rankedRows.filter((row) => finite(row[factor.rankKey]));
    const walkForward = purgedWalkForward(eligibleRows, {
      baselineKeys,
      candidateKey: factor.rankKey,
      targetKey,
    });
    const permutation = blockPermutationTest(eligibleRows, {
      baselineKeys,
      candidateKey: factor.rankKey,
      targetKey,
      observedImprovement: walkForward.metrics.relativeMaeImprovement,
      seed: 20260729 + factorIndex * 100 + targetIndex,
    });
    studies.push({ factor, targetKey, walkForward, permutation });
  }
}

for (const targetKey of targets) {
  applyHolmToPermutation(studies.filter((study) => study.targetKey === targetKey));
}
for (const study of studies) study.verdict = classifyRobustnessStudy(study);

const factorResults = factors.map((factor) => {
  const factorStudies = studies.filter((study) => study.factor.key === factor.key);
  const strongest = [...factorStudies].sort((left, right) =>
    Number(right.walkForward.metrics.relativeMaeImprovement ?? -Infinity)
      - Number(left.walkForward.metrics.relativeMaeImprovement ?? -Infinity))[0];
  return {
    key: factor.key,
    label: factor.label,
    group: factor.group,
    rankedCoverageDays: rankedRows.filter((row) => finite(row[factor.rankKey])).length,
    verdict: factorVerdict(factorStudies),
    strongestHistoricalTarget: strongest?.targetKey ?? null,
    strongestRelativeMaeImprovement: strongest?.walkForward.metrics.relativeMaeImprovement ?? null,
    strongestPositiveFoldShare: strongest?.walkForward.positiveFoldShare ?? null,
    strongestPermutationPValue: strongest?.permutation.empiricalPValueOneSided ?? null,
    strongestHolmPassed: strongest?.multipleTesting?.passed ?? false,
    studies: factorStudies.map((study) => ({
      targetKey: study.targetKey,
      usableDays: study.walkForward.usableDays,
      oosPredictions: study.walkForward.predictions.length,
      folds: study.walkForward.folds,
      baseline: study.walkForward.metrics.baseline,
      candidate: study.walkForward.metrics.candidate,
      relativeMaeImprovement: study.walkForward.metrics.relativeMaeImprovement,
      positiveFoldShare: study.walkForward.positiveFoldShare,
      permutation: study.permutation,
      multipleTesting: study.multipleTesting,
      verdict: study.verdict,
    })),
  };
});

const forwardObservationCandidates = factorResults
  .filter((factor) => factor.verdict === 'historical_robustness_signal_requires_forward')
  .map((factor) => factor.key);
const report = {
  schemaVersion: '1.0.0',
  researchVersion: 'V3.10-factor-robustness-wave2-v1',
  generatedAt: new Date().toISOString(),
  protocolSha256: sha256(protocolPath),
  inputFingerprints: {
    alignedDailySha256: sha256(inputPath),
    firstWaveReportSha256: sha256(firstReportPath),
  },
  sourcePeriod: {
    firstDate: sourceRows[0]?.tradeDate ?? null,
    lastDate: sourceRows.at(-1)?.tradeDate ?? null,
    days: sourceRows.length,
  },
  evidenceClassification: 'historical_falsification_not_fresh_holdout',
  historicalEvidenceReused: true,
  freshHoldout: false,
  firstWaveHistoricalHoldoutAlreadyConsumed: firstReport.historicalHoldoutConsumed === true,
  researchOnly: true,
  executionAuthorized: false,
  formalWeightsChanged: false,
  design: {
    minimumRankHistory: 20,
    minimumTrainingDays: 60,
    testWindowDays: 12,
    purgeDays: 1,
    ridgeLambda: 1,
    blockPermutation: { iterations: 1_000, blockSizeDays: 5 },
    multipleTesting: 'Holm across 9 factors within each target',
    meaningfulRelativeMaeImprovement: 0.01,
    requiredPositiveFoldShare: 0.60,
  },
  dataQuality: {
    timeViolations: timeViolations.length,
    inputDays: sourceRows.length,
    uniqueDates: new Set(sourceRows.map((row) => row.tradeDate)).size,
  },
  forwardObservationCandidates,
  promotableFactors: [],
  factorResults,
};

const verdictLabels = {
  historical_robustness_signal_requires_forward: '歷史穩健訊號，仍需全新前向驗證',
  descriptive_robustness_only: '僅描述性穩健觀察',
  not_supported_or_unstable: '不支持或不穩定',
  insufficient_oos: 'OOS不足',
};
const markdown = [
  '# V3.10 第二輪盤中因子穩健性／反證研究',
  '',
  `產生時間：${report.generatedAt}`,
  '',
  '## 結論',
  '',
  `- 歷史輸入：${report.sourcePeriod.days}日；時間違規：${report.dataQuality.timeViolations}。`,
  '- 本輪重用已檢視歷史，只是反證測試，不是新的Holdout。',
  `- 可列入全新前向觀察的歷史穩健訊號：${forwardObservationCandidates.length ? forwardObservationCandidates.join('、') : '無'}。`,
  '- 可直接晉升正式模型：無；所有正式權重維持0。',
  '',
  '## 因子判決',
  '',
  '| 因子 | 排名覆蓋日 | 最強歷史目標 | 相對MAE改善 | 正向fold | 置換p值 | Holm | 判決 |',
  '|---|---:|---|---:|---:|---:|---|---|',
  ...factorResults.map((factor) => [
    factor.label,
    factor.rankedCoverageDays,
    factor.strongestHistoricalTarget ?? '—',
    Number.isFinite(Number(factor.strongestRelativeMaeImprovement))
      ? `${(Number(factor.strongestRelativeMaeImprovement) * 100).toFixed(2)}%`
      : '—',
    Number.isFinite(Number(factor.strongestPositiveFoldShare))
      ? `${(Number(factor.strongestPositiveFoldShare) * 100).toFixed(0)}%`
      : '—',
    Number.isFinite(Number(factor.strongestPermutationPValue))
      ? Number(factor.strongestPermutationPValue).toFixed(4)
      : '—',
    factor.strongestHolmPassed ? 'PASS' : 'FAIL',
    verdictLabels[factor.verdict],
  ].join(' | ')).map((line) => `| ${line} |`),
  '',
  '## 方法',
  '',
  '- 每日因子只用過去至少20筆資料轉為滾動百分位，降低尺度與極端值影響。',
  '- 使用60日以上訓練、12日測試、邊界排除1日的Purged Walk-Forward。',
  '- 每個因子與目標使用1,000次5日區塊置換，並在同目標9因子內做Holm修正。',
  '- 通過仍只能等待至少30個全新交易日前向複驗，不能調整正式權重。',
  '',
].join('\n');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, 'ranked-daily.ndjson'),
  `${rankedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
);
fs.writeFileSync(
  path.join(outputDir, 'factor-robustness-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputDir, 'REPORT.md'), `${markdown}\n`);

console.log(JSON.stringify({
  outputDir,
  inputDays: report.sourcePeriod.days,
  timeViolations: report.dataQuality.timeViolations,
  forwardObservationCandidates,
  promotableFactors: report.promotableFactors,
  factorVerdicts: Object.fromEntries(factorResults.map((factor) => [factor.key, factor.verdict])),
}, null, 2));
