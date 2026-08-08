import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  analyzeIncrementalFactor,
  applyHolmCorrection,
  classifyFactor,
} from '../src/intraday-factor-impact.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const priceDir = path.join(root, 'data', 'intraday', 'research', 'v3.8.1-price-volume');
const outputDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-factor-impact');
const barPath = path.join(priceDir, 'bar-features.ndjson');
const labelPath = path.join(priceDir, 'future-labels.ndjson');
const databasePath = path.join(root, 'v2', 'data', 'research-v2.sqlite');
const protocolPath = path.join(root, 'docs', 'research', 'V3_10_FACTOR_IMPACT_PROTOCOL.md');
const baselineKeys = [
  'openingReturn',
  'openingRangeReturn',
  'closeVsVwapReturn',
  'logOpeningVolume',
];
const factorDefinitions = [
  {
    key: 'openingRvol20',
    label: '09:00同時段20日RVOL',
    group: 'intraday_volume',
  },
  {
    key: 'foreignNetDeltaPctOi',
    label: '前日外資期貨淨部位變化／近月OI',
    group: 'futures_positioning',
  },
  {
    key: 'marketOiDeltaPct',
    label: '前日近月市場OI變化率',
    group: 'futures_positioning',
  },
  {
    key: 'maxPainDistancePct',
    label: '前日有效契約Max Pain距TX收盤',
    group: 'option_structure',
  },
  {
    key: 'wallAsymmetryPct',
    label: '前日Call／Put Wall距離不對稱',
    group: 'option_structure',
  },
  {
    key: 'atmIv',
    label: '前日最近可用到期ATM IV',
    group: 'volatility',
  },
  {
    key: 'skew25d',
    label: '前日最近可用到期25D Skew',
    group: 'volatility',
  },
  {
    key: 'basisBps',
    label: '前日期現貨收盤基差bps',
    group: 'basis_term',
  },
  {
    key: 'termSpreadBps',
    label: '前日近次月價差bps',
    group: 'basis_term',
  },
];

function readNdjson(target) {
  return fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function sha256(target) {
  return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function rowsByDate(rows) {
  return new Map(rows.map((row) => [row.trade_date, row]));
}

function latestBefore(rows, tradeDate) {
  let result = null;
  for (const row of rows) {
    if (row.trade_date >= tradeDate) break;
    result = row;
  }
  return result;
}

function previousRow(rows, sourceDate) {
  let result = null;
  for (const row of rows) {
    if (row.trade_date >= sourceDate) break;
    result = row;
  }
  return result;
}

function optionContext(optionsRows, volatilityRows, sourceDate, targetDate, txClose) {
  const candidates = optionsRows
    .filter((row) => row.trade_date === sourceDate
      && row.expiry_date >= targetDate
      && finite(row.call_wall_strike)
      && finite(row.put_wall_strike)
      && finite(row.max_pain))
    .sort((left, right) => left.expiry_date.localeCompare(right.expiry_date)
      || Number(right.call_volume + right.put_volume) - Number(left.call_volume + left.put_volume));
  const selected = candidates[0] || null;
  const volatility = volatilityRows
    .filter((row) => row.trade_date === sourceDate
      && row.expiry_date >= targetDate
      && finite(row.atm_iv))
    .sort((left, right) => left.expiry_date.localeCompare(right.expiry_date)
      || Number(right.observations || 0) - Number(left.observations || 0))[0] || null;
  return {
    optionContract: selected?.contract || null,
    optionExpiry: selected?.expiry_date || null,
    maxPainDistancePct: selected && finite(txClose)
      ? (Number(selected.max_pain) - Number(txClose)) / Number(txClose)
      : null,
    wallAsymmetryPct: selected && finite(txClose)
      ? (Number(selected.call_wall_strike) + Number(selected.put_wall_strike) - 2 * Number(txClose))
        / Number(txClose)
      : null,
    atmIv: volatility?.atm_iv ?? null,
    skew25d: volatility?.skew_25d ?? null,
    volatilityContract: volatility?.contract || null,
    volatilityExpiry: volatility?.expiry_date || null,
    optionAvailableAt: volatility?.available_at || `${sourceDate}T16:45:00+08:00`,
  };
}

function openReadOnlyDatabase(target) {
  return new DatabaseSync(target, { readOnly: true });
}

const bars = readNdjson(barPath);
const labels = readNdjson(labelPath);
const anchors = bars.filter((row) => row.barIndex === 2);
const labelsByKey = new Map(labels.map((row) => [`${row.tradeDate}:${row.barIndex}`, row]));
const db = openReadOnlyDatabase(databasePath);
const marketRows = db.prepare('SELECT trade_date, tx_close FROM market_daily ORDER BY trade_date').all();
const positionRows = db.prepare('SELECT trade_date, foreign_net FROM futures_positions_daily ORDER BY trade_date').all();
const oiRows = db.prepare('SELECT trade_date, research_oi FROM futures_oi_daily ORDER BY trade_date').all();
const optionRows = db.prepare(`
  SELECT trade_date, contract, expiry_date, call_volume, put_volume,
         call_wall_strike, put_wall_strike, max_pain
  FROM options_contract_daily
  ORDER BY trade_date, expiry_date, contract
`).all();
const volatilityRows = db.prepare(`
  SELECT trade_date, contract, expiry_date, atm_iv, skew_25d, available_at, observations
  FROM option_volatility_daily
  ORDER BY trade_date, contract
`).all();
const basisRows = db.prepare(`
  SELECT trade_date, close_basis_bps, term_spread_bps
  FROM basis_term_structure_daily
  ORDER BY trade_date
`).all();
db.close();

const marketByDate = rowsByDate(marketRows);
const oiByDate = rowsByDate(oiRows);
const aligned = anchors.map((anchor) => {
  const label = labelsByKey.get(`${anchor.tradeDate}:${anchor.barIndex}`);
  const market = latestBefore(marketRows, anchor.tradeDate);
  const positions = latestBefore(positionRows, anchor.tradeDate);
  const positionsPrevious = positions ? previousRow(positionRows, positions.trade_date) : null;
  const oi = latestBefore(oiRows, anchor.tradeDate);
  const oiPrevious = oi ? previousRow(oiRows, oi.trade_date) : null;
  const basis = latestBefore(basisRows, anchor.tradeDate);
  const sourceDate = market?.trade_date || null;
  const txClose = sourceDate ? marketByDate.get(sourceDate)?.tx_close : null;
  const options = sourceDate
    ? optionContext(optionRows, volatilityRows, sourceDate, anchor.tradeDate, txClose)
    : {};
  const foreignNetDelta = positions && positionsPrevious
    ? Number(positions.foreign_net) - Number(positionsPrevious.foreign_net)
    : null;
  const sourceOi = sourceDate ? oiByDate.get(sourceDate)?.research_oi : oi?.research_oi;
  const marketOiDeltaPct = oi && oiPrevious && Number(oiPrevious.research_oi) !== 0
    ? (Number(oi.research_oi) - Number(oiPrevious.research_oi)) / Number(oiPrevious.research_oi)
    : null;
  const target = {
    return30: label?.horizons?.m30?.complete ? label.horizons.m30.closeReturn : null,
    return60: label?.horizons?.m60?.complete ? label.horizons.m60.closeReturn : null,
    return120: label?.horizons?.m120?.complete ? label.horizons.m120.closeReturn : null,
    excursion30: label?.horizons?.m30?.complete
      ? Math.max(Number(label.horizons.m30.mfeReturn), Math.abs(Number(label.horizons.m30.maeReturn)))
      : null,
    excursion60: label?.horizons?.m60?.complete
      ? Math.max(Number(label.horizons.m60.mfeReturn), Math.abs(Number(label.horizons.m60.maeReturn)))
      : null,
    excursion120: label?.horizons?.m120?.complete
      ? Math.max(Number(label.horizons.m120.mfeReturn), Math.abs(Number(label.horizons.m120.maeReturn)))
      : null,
  };
  return {
    schemaVersion: '1.0.0',
    rowType: 'v3.10_factor_anchor',
    tradeDate: anchor.tradeDate,
    decisionAvailableAt: anchor.featureAvailableAt,
    anchorBarIndex: anchor.barIndex,
    factorSourceDate: sourceDate,
    asOfRule: 'strictly_prior_trade_date',
    openingReturn: anchor.sessionOpenToCloseReturn,
    openingRangeReturn: anchor.openingRangeHigh && anchor.openingRangeLow
      ? (Number(anchor.openingRangeHigh) - Number(anchor.openingRangeLow)) / Number(anchor.openingRangeLow)
      : null,
    closeVsVwapReturn: anchor.closeVsVwapProxyReturn,
    logOpeningVolume: Math.log1p(Number(anchor.cumulativeVolume)),
    openingRvol20: anchor.rvol20SameSlot,
    foreignNetDeltaPctOi: finite(foreignNetDelta) && finite(sourceOi) && Number(sourceOi) !== 0
      ? Number(foreignNetDelta) / Number(sourceOi)
      : null,
    marketOiDeltaPct,
    maxPainDistancePct: options.maxPainDistancePct ?? null,
    wallAsymmetryPct: options.wallAsymmetryPct ?? null,
    atmIv: options.atmIv ?? null,
    skew25d: options.skew25d ?? null,
    basisBps: basis?.close_basis_bps ?? null,
    termSpreadBps: basis?.term_spread_bps ?? null,
    optionContract: options.optionContract ?? null,
    optionExpiry: options.optionExpiry ?? null,
    volatilityContract: options.volatilityContract ?? null,
    volatilityExpiry: options.volatilityExpiry ?? null,
    optionAvailableAt: options.optionAvailableAt ?? null,
    ...target,
    researchOnly: true,
    executionAuthorized: false,
  };
}).sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));

const timeViolations = aligned.filter((row) => !row.factorSourceDate || row.factorSourceDate >= row.tradeDate);
const holdoutStartIndex = Math.floor(aligned.length * 0.80);
const holdoutStartDate = aligned[holdoutStartIndex]?.tradeDate || null;
const targetKeys = ['return30', 'return60', 'return120', 'excursion30', 'excursion60', 'excursion120'];
const studies = [];
for (let factorIndex = 0; factorIndex < factorDefinitions.length; factorIndex += 1) {
  const factor = factorDefinitions[factorIndex];
  for (let targetIndex = 0; targetIndex < targetKeys.length; targetIndex += 1) {
    studies.push({
      factor,
      ...analyzeIncrementalFactor(aligned, {
        baselineKeys,
        candidateKey: factor.key,
        targetKey: targetKeys[targetIndex],
        holdoutStartDate,
        seed: 20260729 + factorIndex * 100 + targetIndex,
      }),
    });
  }
}
for (const targetKey of targetKeys) {
  applyHolmCorrection(studies.filter((study) => study.targetKey === targetKey));
}
const factorResults = factorDefinitions.map((factor) => {
  const factorStudies = studies.filter((study) => study.factor.key === factor.key);
  return {
    ...factor,
    coverageDays: aligned.filter((row) => finite(row[factor.key])).length,
    verdict: classifyFactor(factorStudies),
    studies: factorStudies.map((study) => ({
      targetKey: study.targetKey,
      sample: study.sample,
      development: study.development,
      holdout: study.holdout,
      bootstrap: study.bootstrap,
      multipleTesting: study.multipleTesting,
      descriptiveHoldoutContrast: study.descriptiveHoldoutContrast,
      standardizedFactorCoefficient: study.standardizedFactorCoefficient,
    })),
  };
});
const report = {
  schemaVersion: '1.0.0',
  researchVersion: 'V3.10-factor-impact-initial-v1',
  generatedAt: new Date().toISOString(),
  protocolSha256: sha256(protocolPath),
  inputFingerprints: {
    barFeaturesSha256: sha256(barPath),
    futureLabelsSha256: sha256(labelPath),
    databaseBytes: fs.statSync(databasePath).size,
    databaseModifiedAt: fs.statSync(databasePath).mtime.toISOString(),
  },
  researchOnly: true,
  executionAuthorized: false,
  formalWeightsChanged: false,
  historicalHoldoutConsumed: true,
  futureForwardValidationRequired: true,
  design: {
    decisionAnchor: '09:00 Asia/Taipei after barIndex=2 is complete',
    asOfRule: 'All daily chip/option factors use a strictly earlier trade_date.',
    baselineKeys,
    split: {
      totalDays: aligned.length,
      developmentDays: holdoutStartIndex,
      holdoutDays: aligned.length - holdoutStartIndex,
      holdoutStartDate,
    },
    walkForward: { minimumTrainingDays: 60, testWindowDays: 12 },
    ridgeLambda: 1,
    blockBootstrap: { iterations: 2_000, blockSizeDays: 5 },
    multipleTesting: 'Holm correction within each target family',
  },
  dataQuality: {
    alignedDays: aligned.length,
    firstDate: aligned[0]?.tradeDate || null,
    lastDate: aligned.at(-1)?.tradeDate || null,
    timeViolations: timeViolations.length,
    targetCoverage: Object.fromEntries(targetKeys.map((key) => [
      key,
      aligned.filter((row) => finite(row[key])).length,
    ])),
    factorCoverage: Object.fromEntries(factorDefinitions.map((factor) => [
      factor.key,
      aligned.filter((row) => finite(row[factor.key])).length,
    ])),
  },
  factorResults,
  overallDecision: {
    promotableFactors: factorResults
      .filter((factor) => factor.verdict.includes('candidate_for_forward_validation'))
      .map((factor) => factor.key),
    formalWeightDecision: 'KEEP_ALL_AT_ZERO',
    note: 'Historical holdout is now inspected. Any candidate must pass genuinely new forward data before promotion.',
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, 'aligned-daily.ndjson'),
  `${aligned.map((row) => JSON.stringify(row)).join('\n')}\n`,
  'utf8',
);
fs.writeFileSync(path.join(outputDir, 'factor-impact-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const verdictLabel = {
  direction_candidate_for_forward_validation: '方向候選，僅能進入全新前向驗證',
  risk_filter_candidate_for_forward_validation: '風險過濾候選，僅能進入全新前向驗證',
  descriptive_observation_only: '僅描述觀察',
  not_supported_or_unstable: '不支持或不穩定',
  insufficient_holdout: '保留樣本不足',
};
const markdown = [
  '# V3.10 第一輪盤中因子影響研究',
  '',
  `產生時間：${report.generatedAt}`,
  '',
  '## 結論',
  '',
  `- 對齊交易日：${aligned.length}；時間違規：${timeViolations.length}。`,
  `- 開發期：${holdoutStartIndex}日；歷史保留期：${aligned.length - holdoutStartIndex}日，自${holdoutStartDate}起。`,
  `- 可進入全新前向驗證的候選：${report.overallDecision.promotableFactors.length
    ? report.overallDecision.promotableFactors.join('、')
    : '無'}。`,
  '- 所有正式權重維持0；本報告不產生交易建議。',
  '- 歷史保留期已被檢視，往後不得再稱為未看過的最終驗證。',
  '',
  '## 因子判決',
  '',
  '| 因子 | 群組 | 覆蓋日 | 判決 |',
  '|---|---|---:|---|',
  ...factorResults.map((factor) => `| ${factor.label} | ${factor.group} | ${factor.coverageDays} | ${verdictLabel[factor.verdict] || factor.verdict} |`),
  '',
  '## 研究邊界',
  '',
  '- 每日只取09:00一個錨點，避免把重疊K棒當成獨立樣本。',
  '- 盤後籌碼只使用嚴格早於研究日的資料。',
  '- 價格基準與單一新增因子使用完全相同日期比較。',
  '- 使用時間序列Walk-Forward、最後20%歷史保留期、5日移動區塊Bootstrap及Holm多重比較修正。',
  '- 公開OI、Max Pain與牆位不是Dealer真實成本或持倉。',
  '- 精確CVD、即時Greeks及Dealer真實部位不在本輪資料中。',
  '',
].join('\n');
fs.writeFileSync(path.join(outputDir, 'REPORT.md'), `${markdown}\n`, 'utf8');
console.log(JSON.stringify({
  outputDir,
  alignedDays: aligned.length,
  holdoutStartDate,
  timeViolations: timeViolations.length,
  promotableFactors: report.overallDecision.promotableFactors,
  factorVerdicts: Object.fromEntries(factorResults.map((factor) => [factor.key, factor.verdict])),
}, null, 2));
