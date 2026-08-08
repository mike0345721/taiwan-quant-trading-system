import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(root, '..');
const reports = path.join(root, 'reports');
const read = (name) => JSON.parse(fs.readFileSync(path.join(reports, name), 'utf8'));
const gate = read('v3-6-2-collection-audit.json');
if (gate.gates?.researchReady !== true || gate.gates?.timingAuditPassed !== true) throw new Error('Research gate is closed.');

const backtest = read('latest-backtest.json');
const mirror = read('mirror-backtest.json');
const paired = read('paired-incremental.json');
const large = read('latest-large-trader-research.json');
const extended = read('v3-6-2-extended-factor-research.json');
const veto = read('no-trade-veto.json');
const vix = read('vix-relative-research.json');
const basis = read('basis-term-structure-research.json');
const reverse = read('reverse-large-move-study.json');
const protocol = fs.readFileSync(path.join(projectRoot, 'V3_6_2_CROSS_MARKET_RESEARCH_PROTOCOL.md'), 'utf8');
const protocolSha256 = crypto.createHash('sha256').update(protocol).digest('hex');

const finite = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const f = (value, digits = 2) => finite(value) ? Number(value).toFixed(digits) : '—';
const pairedRows = paired.families.flatMap((family) => [family.development, family.holdout].flatMap((period) => period.comparisons.map((item) => ({
  family: family.family, period: period.period, comparator: item.comparatorKey, days: item.days,
  observed: item.observedTotalDifference, ci95: item.ci95, supported: item.supported,
}))));
const pairedHoldoutPassed = pairedRows.filter((row) => row.period === 'final_holdout' && row.supported);
const firstGate = backtest.strategies.filter((item) => item.gate === 'passed_first_gate');

const stageSummary = [
  { stage: 'R0', verdict: '未建立可超越基準的籌碼優勢', evidenceLevel: 1, detail: '價格、價格＋OI、長期漂移的共同日期配對比較，在最終留出期沒有任何籌碼候選取得正的95%下緣。' },
  { stage: 'R1', verdict: '3項通過舊版第一關，但均未升級', evidenceLevel: 1, detail: `外資期貨5日變化、價格OI反轉2日、外資單日加空隔日共${firstGate.length}項標示passed_first_gate；尚未通過配對增量與新前推。` },
  { stage: 'R2', verdict: '跨市場增量未通過', evidenceLevel: 1, detail: `最終留出配對通過 ${pairedHoldoutPassed.length} 項；外資現貨＋期貨、投信及自營商組合未證明額外價值。` },
  { stage: 'R3', verdict: '大額部位只保留結構觀察', evidenceLevel: 1, detail: '大額交易人與隔日日盤方向的線性相關很低；轉倉日須獨立標記，不能直接解讀成多空。' },
  { stage: 'R4', verdict: '選擇權攻防沒有方向候選', evidenceLevel: 1, detail: '牆位與Max Pain策略未通過；ATM IV與Skew有波動線索，但Holm校正未通過。' },
  { stage: 'R5', verdict: '未啟動', evidenceLevel: 0, detail: 'R2至R4沒有配對模型通過最終留出增量門檻，依預註冊停止三市場交集。既有探索輸出不得算作R5證據。' },
  { stage: 'R6', verdict: 'VIX保留為風險觀察，其餘不計分', evidenceLevel: 2, detail: 'VIX上升對絕對波動的放大在前後期同向；不交易否決層仍因留出樣本不足而不能上線。' },
  { stage: 'R7', verdict: '產生下一版假說，不回填本輪', evidenceLevel: 1, detail: `辨識大漲${reverse.eventCounts.large_rise}、大跌${reverse.eventCounts.large_fall}、大區間${reverse.eventCounts.large_range}日；外資期貨5日變化在大跌前出現較一致差異，但只能前推驗證。` },
];

const report = {
  version: '3.6.2', generatedAt: new Date().toISOString(), researchStarted: true,
  protocolSha256, gateGeneratedAt: gate.generatedAt, gate: gate.gates,
  methodology: {
    entry: 'All post-close signals enter no earlier than the next regular-session open.',
    missing: 'Missing values are excluded and never converted to zero.',
    holdout: 'The final holdout is historical and has been viewed before; it is not pristine forward evidence.',
    r5Rule: 'R5 is closed because no R2-R4 paired model passed final-holdout incremental support.',
  },
  stageSummary,
  firstGateStrategies: firstGate.map((item) => ({ key: item.key, gate: item.gate, walkForward: item.metrics, holdout: item.holdout?.metrics })),
  pairedIncremental: pairedRows,
  mirrorCounts: mirror.counts,
  extendedStudies: extended.studies,
  largeTraderCorrelations: large.correlations,
  vetoStudies: veto.studies,
  vix: { coverage: vix.coverage, correlations: vix.correlations, chronologicalCheck: vix.chronologicalCheck },
  basisDecision: basis.scoreDecision,
  reverseEvents: { counts: reverse.eventCounts, candidates: reverse.candidates },
  allStrategyResults: backtest.strategies.map((item) => ({ key: item.key, label: item.label, gate: item.gate, walkForward: item.metrics, holdout: item.holdout?.metrics })),
  decision: {
    dashboardDirectionScoreChange: false,
    liveOrSimulationEligible: false,
    highestEvidence: 2,
    highestEvidenceLabel: 'risk_candidate_observation',
    nextStep: 'Freeze the VIX risk observation and R7 foreign-futures precursor definitions, then collect at least 30 genuinely new forward outcomes before promotion review.',
  },
};
fs.writeFileSync(path.join(reports, 'v3-6-2-cross-market-research.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const strategyRows = backtest.strategies.map((item) => `| ${item.key} | ${item.gate} | ${item.metrics?.trades ?? 0} | ${f(item.metrics?.profitFactor)} | ${item.holdout?.metrics?.trades ?? 0} | ${f(item.holdout?.metrics?.profitFactor)} |`).join('\n');
const pairRows = pairedRows.map((item) => `| ${item.family} | ${item.period} | ${item.comparator} | ${item.days ?? 0} | ${f(item.observed, 0)} | ${f(item.ci95?.[0], 0)}～${f(item.ci95?.[1], 0)} | ${item.supported ? '通過' : '未通過'} |`).join('\n');
const extendedRows = extended.studies.map((item) => `| ${item.stage} | ${item.label} | ${item.samples.holdoutTails} | ${f(item.directional.strategy.profitFactor)} | ${f(item.directional.mirror.profitFactor)} | ${f(item.risk.holdout.observed)} | ${item.directional.holdout.holmPassed ? '方向通過' : item.risk.holdout.holmPassed ? '風險通過' : item.preliminaryVerdict} |`).join('\n');
const reverseRows = reverse.candidates.map((item) => `| ${item.eventType} | ${item.precursorDays} | ${item.feature} | ${f(item.standardizedDifference, 3)} | ${item.status} |`).join('\n');
const stageRows = stageSummary.map((item) => `| ${item.stage} | ${item.verdict} | ${item.evidenceLevel} | ${item.detail} |`).join('\n');

const markdown = `# V3.6.2 跨市場大研究完整報告\n\n產生時間：${report.generatedAt}\n\n協議 SHA-256：\`${protocolSha256}\`\n\n## 先說結論\n\n- 品質、涵蓋率與 available_at 時間閘門重新通過，\`researchReady=true\` 後才開始研究。\n- 沒有任何方向模型達到證據等級3；目前不得調整首頁方向分數，也不得進入模擬或實單。\n- 最高只到證據等級2：VIX上升仍較適合當波動／縮小曝險參考，不是做空訊號。\n- 外資期貨5日變化、價格OI反轉2日、外資單日加空隔日雖通過舊版第一關，但共同日期配對增量在最終留出期全部未通過。\n- R5沒有前置合格模型，因此依協議停止，沒有搜尋三市場交集。\n- R7顯示大跌前較常見外資期貨偏弱及空單增加，但這是下一版假說，不能回頭當本輪有效策略。\n\n## R0～R7總表\n\n| 階段 | 判定 | 證據等級 | 說明 |\n|---|---|---:|---|\n${stageRows}\n\n## 正向、反向與未通過概況\n\n- 舊版完整策略共 ${backtest.strategies.length} 項；通過舊版第一關 ${firstGate.length} 項。\n- 鏡像報告：原方向支持 ${mirror.counts.original_direction_supported}、反向候選 ${mirror.counts.contrarian_candidate}、只在留出期反向 ${mirror.counts.holdout_only_contrarian}、不確定 ${mirror.counts.inconclusive}、樣本不足 ${mirror.counts.insufficient_sample}。\n- 以上鏡像結果均未因此升級；反向規則須視為新假說並等待新前推資料。\n\n## 共同日期配對增量\n\n| 家族 | 期間 | 比較對象 | 共同日 | 差異點數 | 95%區間 | 判定 |\n|---|---|---|---:|---:|---:|---|\n${pairRows}\n\n## 新補齊因子\n\n| 階段 | 因子 | 留出尾端樣本 | 正向PF | 鏡像PF | 高值減低值絕對波動 | 判定 |\n|---|---|---:|---:|---:|---:|---|\n${extendedRows}\n\nATM IV與Skew的高值組在留出期呈現較大絕對波動，但經同家族Holm校正後未通過；只能保留描述觀察。上櫃廣度的方向PF雖為 ${f(extended.studies.find((item) => item.key === 'tpexBreadth')?.directional.strategy.profitFactor)}，留出尾端僅 ${extended.studies.find((item) => item.key === 'tpexBreadth')?.samples.holdoutTails ?? 0} 筆且信賴區間跨0，不是方向候選。\n\n## R6風險層\n\n- VIX 5日上升高值組的絕對波動放大：開發區約 ${f((JSON.parse(fs.readFileSync(path.join(reports, 'macro-factor-candidates.json'), 'utf8')).studies.vix5dPct.early70.highVolatilityLift), 2)} 倍，後段約 ${f((JSON.parse(fs.readFileSync(path.join(reports, 'macro-factor-candidates.json'), 'utf8')).studies.vix5dPct.late30.highVolatilityLift), 2)} 倍。\n- 高波動否決層在留出期排除5筆後，保留交易PF由 ${f(veto.studies.find((item) => item.key === 'high_vol_regime')?.holdout.all.profitFactor)} 提升到 ${f(veto.studies.find((item) => item.key === 'high_vol_regime')?.holdout.kept.profitFactor)}，但樣本未達門檻，判定仍為 \`insufficient_holdout\`。\n- 基差及期限結構：${basis.scoreDecision.decision}\n\n## R7大行情前兆\n\n事件數：大漲 ${reverse.eventCounts.large_rise}、大跌 ${reverse.eventCounts.large_fall}、大區間 ${reverse.eventCounts.large_range}。下表完整保留探索候選；它們只產生下一版假說。\n\n| 事件 | 前置天數 | 因子 | 標準化差異 | 狀態 |\n|---|---:|---|---:|---|\n${reverseRows}\n\n## 所有正式策略結果\n\n| 策略 | 閘門 | Walk-forward交易 | Walk-forward PF | 留出交易 | 留出PF |\n|---|---|---:|---:|---:|---:|\n${strategyRows}\n\n## 最終決策\n\n1. 首頁方向評分不變，所有新因子研究權重維持0。\n2. VIX可保留研究頁風險提示，但不得顯示成做多／做空。\n3. 凍結R7的外資期貨前兆定義，至少收集30筆真正未看過的前推事件再複驗。\n4. R5、模擬交易與實單都不啟動。\n5. 本次歷史留出資料已被看過，後續不得再稱為全新驗證。\n`;
fs.writeFileSync(path.join(reports, 'V3_6_2_CROSS_MARKET_RESEARCH_REPORT.md'), markdown, 'utf8');
fs.writeFileSync(path.join(reports, 'v3-6-2-research-run.json'), `${JSON.stringify({ researchStarted: true, generatedAt: report.generatedAt, protocolSha256, researchReady: true, finalReport: 'V3_6_2_CROSS_MARKET_RESEARCH_REPORT.md' }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ generatedAt: report.generatedAt, protocolSha256, firstGate: firstGate.map((item) => item.key), pairedHoldoutPassed: pairedHoldoutPassed.length, evidence: report.decision, reports: ['v3-6-2-cross-market-research.json', 'V3_6_2_CROSS_MARKET_RESEARCH_REPORT.md'] }, null, 2));
