import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PHASE_A_DIR = path.join(ROOT, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30-a13-v2');
const RECON_DIR = path.join(ROOT, 'data', 'research', 'pp1-contract-reconciliation-v1', 'run-2026-08-01');
const OUTPUT_DIR = path.join(ROOT, 'data', 'research', 'f3-governance-v2', 'owner-review-2026-08-02');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = (file) => sha256(fs.readFileSync(file));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const evidenceHash = (value, hashes) => sha256(canonical({ value, hashes }));

const a20Path = path.join(PHASE_A_DIR, 'jobs', 'A20-redundancy_cluster.json');
const a30Path = path.join(PHASE_A_DIR, 'jobs', 'A30-freeze_f3_candidates.json');
const a33Path = path.join(PHASE_A_DIR, 'jobs', 'A33-promotion_and_phase_b_queue.json');
const phaseAEvidencePath = path.join(PHASE_A_DIR, 'reports', 'PHASE_A_EVIDENCE.json');
const reconciledViewPath = path.join(RECON_DIR, 'PHASE_A_RECONCILED_VIEW.json');

const a20 = readJson(a20Path);
const a30 = readJson(a30Path);
const a33 = readJson(a33Path);
const reconciledView = readJson(reconciledViewPath);

if (a30.runId !== 'full-historical-phase-a-v1-2026-07-30') throw new Error('Unexpected Phase A runId');
if (a30.f3Candidates?.candidates?.length !== 5) throw new Error('Cohort A must preserve exactly five existing candidates');
if (reconciledView.phaseARunId !== a30.runId) throw new Error('Reconciled view does not reference the immutable Phase A run');

const governancePolicy = {
  schemaVersion: 'f3-governance-policy-v2',
  eligibleRegistryHasArbitraryCap: false,
  activeValidationCohortMaximum: 5,
  activeCohortSelectionFrozen: true,
  onlyOriginalF2PassMayBeReviewedForDeferredEligibility: true,
  f2FailRescueForbidden: true,
  targetFamilyCapacity: { primary: 1, challenger: 1 },
  deferredOrderFrozenBeforeNewEvidence: true,
  maximumPromotionFromThisWork: 'F3_PREREGISTRATION_CANDIDATE',
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};

const hashes = {
  phaseAOriginalEvidenceHash: reconciledView.originalEvidenceHash,
  phaseAReconciledViewHash: fileHash(reconciledViewPath),
  pp1PolicySpecHash: reconciledView.pp1PolicySpecHash,
  governancePolicyHash: sha256(canonical(governancePolicy)),
  a20RedundancyHash: fileHash(a20Path),
  a30OriginalCandidatesHash: fileHash(a30Path),
  a33OriginalPromotionBoardHash: fileHash(a33Path),
  phaseAEvidenceFileHash: fileHash(phaseAEvidencePath),
};

const clusterByFactor = new Map();
for (const cluster of a20.redundancy.clusters) {
  for (const factorId of cluster.members) clusterByFactor.set(factorId, cluster.clusterId);
}

const activeDetails = {
  F3C01: {
    marketMechanism: '選擇權隱含波動、OI與已實現波動共同反映隔日大幅波動的定價與部位壓力。',
    economicRationale: '期權價格與部位結構可能比單純價格更早反映隔日波動需求，但不直接代表方向。',
    productRole: 'Regime / Risk Veto',
    fixedFormula: 'Frozen Phase A OPTIONS evidence block + Ridge Logistic(lambda=1, train-only standardization)',
    expectedDirection: '較高模型分數對應較高 next_day_large_move 事件機率。',
    targetFamily: 'NEXT_DAY_LARGE_MOVE',
    targetFamilyRole: 'PRIMARY',
    overlappingCandidates: ['F3C05'],
  },
  F3C02: {
    marketMechanism: '自營避險與投信流量的水位及持續性可能代表隔日供需失衡。',
    economicRationale: '現貨法人資金流可能造成隔日價格調整，但與期權波動定價是不同來源。',
    productRole: 'Risk Veto / Regime',
    fixedFormula: 'Frozen Phase A CASH evidence block + Ridge Logistic(lambda=1, train-only standardization)',
    expectedDirection: '較高模型分數對應較高 next_day_large_move 事件機率。',
    targetFamily: 'NEXT_DAY_LARGE_MOVE',
    targetFamilyRole: 'CHALLENGER',
    overlappingCandidates: ['F3C03'],
  },
  F3C03: {
    marketMechanism: '現貨避險與投信持續流量可能對隔日下行尾部造成不對稱壓力。',
    economicRationale: '流量失衡的下行風險用途不同於一般方向預測。',
    productRole: 'Risk Veto',
    fixedFormula: 'Frozen Phase A CASH evidence block + Ridge Logistic(lambda=1, train-only standardization)',
    expectedDirection: '較高模型分數對應較高 next_day_downside_tail 事件機率。',
    targetFamily: 'NEXT_DAY_DOWNSIDE_TAIL',
    targetFamilyRole: 'PRIMARY',
    overlappingCandidates: ['F3C02'],
  },
  F3C04: {
    marketMechanism: '期貨法人部位的水位與變化可能反映中短期方向性曝險。',
    economicRationale: '法人期貨曝險可能跨日延續，但公開部位不等於 Dealer 真實部位。',
    productRole: 'Direction Bias / Regime',
    fixedFormula: 'Frozen Phase A FUTURES evidence block + Ridge Regression(lambda=1, train-only standardization)',
    expectedDirection: '模型預測值的正負對應 next_5d_tx_return 的方向。',
    targetFamily: 'NEXT_5D_DIRECTION',
    targetFamilyRole: 'PRIMARY',
    overlappingCandidates: [],
  },
  F3C05: {
    marketMechanism: 'IV期限差、PCR、OI與已實現波動可能描述隔日交易區間大小。',
    economicRationale: '波動結構較適合預估範圍或風險，不應直接翻譯成多空。',
    productRole: 'Regime / Position Sizing',
    fixedFormula: 'Frozen Phase A OPTIONS evidence block + Huber Regression(delta=1.345, train-only standardization)',
    expectedDirection: '較高模型值對應較大的 next_day_range。',
    targetFamily: 'NEXT_DAY_RANGE',
    targetFamilyRole: 'PRIMARY',
    overlappingCandidates: ['F3C01'],
  },
};

const commonCandidate = {
  availableAt: '所有盤後官方資料只可於下一交易日、且來源合法 availableAt 之後使用。',
  baselineDefinition: 'Phase B 必須使用經 Owner 核准且 Hash 凍結的 T0 H0；目前尚未存在可執行的 T0 Hash。',
  rejectionCriteria: [
    '成本後增量不具實質意義',
    'Purged Walk-forward 跨 Fold 或跨 Regime 不穩定',
    '效果由少數極端日主導',
    '負控制、Placebo、Bootstrap 或 Holm 修正不通過',
    '資料品質、availableAt 或重播 Gate 不通過',
  ],
  validationMethod: 'B0預先登記 → B1單候選增量 → B2角色檢驗 → B3成本、Walk-forward與穩定性 → B4歷史F4候選審查。',
};

const activeCandidates = a30.f3Candidates.candidates.map((candidate) => {
  const detail = activeDetails[candidate.candidateId];
  if (!detail) throw new Error(`Missing active candidate governance detail: ${candidate.candidateId}`);
  const normalized = {
    candidateId: candidate.candidateId,
    cohortId: 'F3_ACTIVE_COHORT_A',
    cohortClassification: 'ACTIVE_COHORT_A',
    marketMechanism: detail.marketMechanism,
    economicRationale: detail.economicRationale,
    productRole: detail.productRole,
    evidenceBlock: candidate.blockId,
    fixedFactors: candidate.factors,
    fixedFormula: detail.fixedFormula,
    fixedTarget: candidate.targetId,
    expectedDirection: detail.expectedDirection,
    ...commonCandidate,
    overlappingCandidates: detail.overlappingCandidates,
    redundancyCluster: [...new Set(candidate.factors.map((factorId) => clusterByFactor.get(factorId)).filter(Boolean))],
    contractPolicyStatus: candidate.contractPolicyStatus,
    targetFamily: detail.targetFamily,
    targetFamilyRole: detail.targetFamilyRole,
    promotionStage: 'F3_PREREGISTRATION_CANDIDATE',
    evaluationStatus: 'PENDING',
    promotionEligible: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  normalized.evidenceHash = evidenceHash(normalized, hashes);
  return normalized;
});

const deferredDefinitions = [
  {
    candidateId: 'F3D01', cohortId: 'F3_ELIGIBLE_COHORT_B', cohortClassification: 'ELIGIBLE_COHORT_B', priority: 1,
    marketMechanism: '市場總OI與近月OI的相對水位可能區分槓桿擴張、換月與流動性風險。',
    economicRationale: 'OI結構較適合作為Regime或NO_TRADE條件，而非直接多空票。', productRole: 'Regime / Risk Veto',
    evidenceBlock: 'FUTURES_OI_STRUCTURE_DEFERRED', fixedFactors: ['all_contracts_market_oi', 'near_contract_oi'],
    fixedFormula: '兩項原始盤後OI各自保留，不投票、不先定權重；Phase B僅比較加入此Evidence Block的增量。',
    fixedTarget: 'T0_NO_TRADE_QUALITY_AND_FALSE_BREAKOUT', expectedDirection: '極端或衝突OI結構預期提高NO_TRADE／假突破風險。',
    overlappingCandidates: ['F3C04'], contractPolicyStatus: 'PP1_RECONCILED_NON_MATERIAL', targetFamily: 'T0_REGIME_NO_TRADE', targetFamilyRole: 'PRIMARY',
  },
  {
    candidateId: 'F3D02', cohortId: 'F3_ELIGIBLE_COHORT_B', cohortClassification: 'ELIGIBLE_COHORT_B', priority: 2,
    marketMechanism: '現價相對Max Pain的距離可能描述結算吸附或偏離風險。',
    economicRationale: 'Max Pain不應直接預測方向，較合理用途是結算情境下的Confirmation或Risk Veto。', productRole: 'Confirmation / Risk Veto',
    evidenceBlock: 'OPTIONS_MAX_PAIN_DISTANCE_DEFERRED', fixedFactors: ['options_max_pain_distance'],
    fixedFormula: '沿用Phase A固定原始距離定義；不得改門檻或依結果選擇結算窗口。',
    fixedTarget: 'T0_FALSE_BREAKOUT', expectedDirection: '偏離程度與結算狀態的預先登記關係若不穩定即否決。',
    overlappingCandidates: ['F3C01', 'F3C05'], contractPolicyStatus: 'NOT_APPLICABLE', targetFamily: 'T0_FALSE_BREAKOUT', targetFamilyRole: 'PRIMARY',
  },
  {
    candidateId: 'F3D03', cohortId: 'F3_ELIGIBLE_COHORT_C', cohortClassification: 'ELIGIBLE_COHORT_C', priority: 3,
    marketMechanism: '基差相對60日歷史水位可能描述期現貨壓力與換約附近的市場狀態。',
    economicRationale: '基差水位的主要用途是Regime與Roll風險，不應直接冒充可交易方向。', productRole: 'Regime / Risk Veto',
    evidenceBlock: 'FUTURES_BASIS_REGIME_DEFERRED', fixedFactors: ['basis_level_z60'],
    fixedFormula: '沿用PP-1 Reconciled View與Phase A frozen past-only z60公式。',
    fixedTarget: 'T0_NO_TRADE_QUALITY_AND_FALSE_BREAKOUT', expectedDirection: '極端基差狀態預期增加換約／假突破風險；不預設多空。',
    overlappingCandidates: ['F3D01'], contractPolicyStatus: 'PP1_RECONCILED_NON_MATERIAL', targetFamily: 'T0_REGIME_NO_TRADE', targetFamilyRole: 'CHALLENGER',
  },
  {
    candidateId: 'F3D04', cohortId: 'F3_ELIGIBLE_COHORT_C', cohortClassification: 'ELIGIBLE_COHORT_C', priority: 4,
    marketMechanism: '大額交易人前十大多方部位可能反映集中型中短期方向曝險。',
    economicRationale: '大額交易人集中度與法人分類部位來源不同，可作Futures方向候選的非同義挑戰者。', productRole: 'Direction Bias / Regime',
    evidenceBlock: 'LARGE_TRADER_POSITIONING_DEFERRED', fixedFactors: ['top10_long'],
    fixedFormula: '沿用Phase A原始top10_long，不與top5_long重複計功。',
    fixedTarget: 'T0_COST_ADJUSTED_RETURN', expectedDirection: '較高多方集中度預期改善T0多方Setup的成本後結果；空方另行報告。',
    overlappingCandidates: ['F3C04'], contractPolicyStatus: 'NOT_APPLICABLE', targetFamily: 'T0_DIRECTION_AFTER_COST', targetFamilyRole: 'PRIMARY',
  },
].map((candidate) => {
  const normalized = {
    ...candidate,
    ...commonCandidate,
    redundancyCluster: [...new Set(candidate.fixedFactors.map((factorId) => clusterByFactor.get(factorId)).filter(Boolean))],
    promotionStage: 'F3_PREREGISTRATION_CANDIDATE', evaluationStatus: 'PENDING', promotionEligible: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  normalized.evidenceHash = evidenceHash(normalized, hashes);
  return normalized;
});

const originalBoard = a33.promotionBoard.board;
const reconcileByFactor = new Map(reconciledView.factorResults.map((row) => [row.factorId, row]));
const originalF2Pass = originalBoard.filter((row) => row.promotionStage === 'F2' && row.evaluationStatus === 'PASS');
const effectiveF2Pass = originalF2Pass.filter((row) => (reconcileByFactor.get(row.factorId)?.reconciledEvaluationStatus || row.evaluationStatus) === 'PASS');

const factorClassification = {
  all_contracts_market_oi: ['ELIGIBLE_COHORT_B', 'F3D01', 'OI結構Regime的主要構成。'],
  basis_level_z60: ['ELIGIBLE_COHORT_C', 'F3D03', 'PP-1校正後仍為F2 PASS，作Regime挑戰者。'],
  futures_foreign_long: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', '同屬法人期貨部位機制，避免重複計功。'],
  futures_foreign_long__sum_or_change_5d: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', '與F3C04的法人期貨部位機制重疊。'],
  futures_foreign_net__delta_1d: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', '與F3C04的法人期貨方向Evidence Block重疊。'],
  futures_foreign_net__sum_or_change_5d: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', '與F3C04的法人期貨方向Evidence Block重疊。'],
  futures_foreign_short__delta_1d: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', '與外資淨部位／長方部位高度同源。'],
  futures_foreign_short__past_only_z60: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', '與F3C04中外資部位水位同源。'],
  futures_trust_net__delta_1d: ['COVERED_BY_ACTIVE_CANDIDATE', 'F3C04', 'F3C04已涵蓋投信期貨部位機制。'],
  near_contract_oi: ['ELIGIBLE_COHORT_B', 'F3D01', 'OI結構Regime的主要構成，PP-1校正後仍PASS。'],
  options_max_pain_distance: ['ELIGIBLE_COHORT_B', 'F3D02', '保留作Confirmation／Risk Veto，不直接投票多空。'],
  top10_long: ['ELIGIBLE_COHORT_C', 'F3D04', '大額交易人機制與法人分類部位不完全相同。'],
};

const classifications = effectiveF2Pass.map((row) => {
  const classification = factorClassification[row.factorId] || ['INSUFFICIENT_MECHANISM', null, '尚未形成非重複且可預先登記的產品機制。'];
  return { factorId: row.factorId, factorGroup: row.factorGroup, classification: classification[0], coveredByCandidateId: classification[1], reason: classification[2] };
});
const downgraded = originalF2Pass.filter((row) => !effectiveF2Pass.some((item) => item.factorId === row.factorId)).map((row) => ({
  factorId: row.factorId, factorGroup: row.factorGroup, classification: 'REJECTED', coveredByCandidateId: null,
  reason: `PP-1 Reconciled View將狀態由${row.evaluationStatus}降為${reconcileByFactor.get(row.factorId)?.reconciledEvaluationStatus || 'FAIL'}；不得救援。`,
}));

const registry = {
  schemaVersion: 'f3-eligible-registry-v2', generatedAt: '2026-08-02T00:00:00+08:00', ...hashes, governancePolicy,
  registryCount: activeCandidates.length + deferredDefinitions.length,
  candidates: [...activeCandidates, ...deferredDefinitions],
  originalF2PassReviewed: originalF2Pass.length,
  effectiveReconciledF2Pass: effectiveF2Pass.length,
  classifications: [...classifications, ...downgraded],
  excludedF2FailRescue: [{ factorId: 'basis_change_5d_bps', classification: 'REJECTED', reason: '原Phase A為F2 FAIL；Reconciliation改善不得用來追溯升級。' }],
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};

const active = {
  schemaVersion: 'f3-active-cohort-v2', cohortId: 'F3_ACTIVE_COHORT_A', ...hashes,
  selectionFrozenBeforeGovernanceAmendment: true, maximumConcurrentCandidates: 5,
  candidates: activeCandidates, evaluationStatus: 'PENDING', promotionEligible: false,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};

const deferred = {
  schemaVersion: 'f3-deferred-cohorts-v2', ...hashes,
  orderingFrozenAt: '2026-08-02T00:00:00+08:00', orderingBasis: '產品機制、非重複性與角色覆蓋；未使用新Forward或T0結果。',
  cohortB: deferredDefinitions.filter((row) => row.cohortClassification === 'ELIGIBLE_COHORT_B'),
  cohortC: deferredDefinitions.filter((row) => row.cohortClassification === 'ELIGIBLE_COHORT_C'),
  otherClassifications: [...classifications, ...downgraded].filter((row) => !row.classification.startsWith('ELIGIBLE_')),
  activationRule: '只有Product Owner可在Active Cohort容量釋出後逐項批准；不得依Cohort A結果重新排名。',
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};

const familyMembers = [...activeCandidates, ...deferredDefinitions].reduce((map, candidate) => {
  map[candidate.targetFamily] ||= [];
  map[candidate.targetFamily].push({ candidateId: candidate.candidateId, role: candidate.targetFamilyRole, productRole: candidate.productRole });
  return map;
}, {});
const targetFamilyChecks = Object.entries(familyMembers).map(([targetFamily, members]) => ({
  targetFamily, members,
  primaryCount: members.filter((row) => row.role === 'PRIMARY').length,
  challengerCount: members.filter((row) => row.role === 'CHALLENGER').length,
  capacityPass: members.filter((row) => row.role === 'PRIMARY').length <= 1 && members.filter((row) => row.role === 'CHALLENGER').length <= 1,
}));

const coverage = {
  schemaVersion: 'f3-redundancy-and-coverage-map-v2', ...hashes,
  targetFamilyChecks,
  allTargetFamiliesWithinCapacity: targetFamilyChecks.every((row) => row.capacityPass),
  candidateCoverage: [...activeCandidates, ...deferredDefinitions].map((candidate) => ({
    candidateId: candidate.candidateId, cohortId: candidate.cohortId, productRole: candidate.productRole,
    targetFamily: candidate.targetFamily, targetFamilyRole: candidate.targetFamilyRole,
    factors: candidate.fixedFactors, redundancyClusters: candidate.redundancyCluster,
    overlaps: candidate.overlappingCandidates,
  })),
  duplicateControlRule: '同一redundancyCluster不得在同一Evidence Block重複計功；Target Family容量最多一個Primary與一個Challenger。',
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};

const markdown = `# F3 Governance Amendment v2\n\n` +
`狀態：OWNER REVIEW；本文件只修訂治理，不代表任何候選已證明Edge。\n\n` +
`## Governance Diff\n\n` +
`- 舊制：整個專案最多保留5個F3候選。\n` +
`- 新制：F3 Eligible Registry不設任意總數上限；同時進入Active Validation的候選最多5組。\n` +
`- 現有F3C01～F3C05原封不動成為F3_ACTIVE_COHORT_A，不因新制度重挑。\n` +
`- 只檢查原Phase A已F2 PASS項目；原F2 FAIL不得因Reconciliation或事後結果救援。\n` +
`- 同一Target Family最多1個Primary與1個Challenger；同一Redundancy Cluster不得重複計功。\n` +
`- Cohort B／C順序在任何新Forward或T0增量結果前凍結。\n\n` +
`## 基準Hash\n\n` + Object.entries(hashes).map(([key, value]) => `- ${key}: \`${value}\``).join('\n') +
`\n\n## 分類摘要\n\n- Active Cohort A：${activeCandidates.length}組。\n- Eligible Cohort B：${deferred.cohortB.length}組。\n- Eligible Cohort C：${deferred.cohortC.length}組。\n- 原F2 PASS檢查：${originalF2Pass.length}項；Reconciled後有效：${effectiveF2Pass.length}項。\n- Target Family容量檢查：${coverage.allTargetFamiliesWithinCapacity ? 'PASS' : 'FAIL'}。\n\n` +
`## 安全邊界\n\n- formalWeight=0\n- researchOnly=true\n- executionAuthorized=false\n- 不覆寫A30、A33、Executive Summary或Reconciliation產物。\n`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const outputs = [
  ['F3_GOVERNANCE_AMENDMENT_v2.md', markdown],
  ['F3_ELIGIBLE_REGISTRY.json', `${JSON.stringify(registry, null, 2)}\n`],
  ['F3_ACTIVE_COHORT_A.json', `${JSON.stringify(active, null, 2)}\n`],
  ['F3_DEFERRED_COHORTS.json', `${JSON.stringify(deferred, null, 2)}\n`],
  ['F3_REDUNDANCY_AND_COVERAGE_MAP.json', `${JSON.stringify(coverage, null, 2)}\n`],
];
for (const [name, contents] of outputs) {
  const target = path.join(OUTPUT_DIR, name);
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== contents) throw new Error(`Refusing to overwrite non-identical governance artifact: ${name}`);
  if (!fs.existsSync(target)) fs.writeFileSync(target, contents, { encoding: 'utf8', flag: 'wx' });
}

console.log(JSON.stringify({ outputDir: OUTPUT_DIR, registryCount: registry.registryCount, activeCount: activeCandidates.length, cohortBCount: deferred.cohortB.length, cohortCCount: deferred.cohortC.length, targetFamilyGate: coverage.allTargetFamiliesWithinCapacity ? 'PASS' : 'FAIL', hashes }, null, 2));
