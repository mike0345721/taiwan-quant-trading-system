import fs from 'node:fs';
import path from 'node:path';
import { auditT0Replay, hashJson } from '../src/t0-data-replay-gate.mjs';

const root = process.cwd();
const outputDir = path.resolve(process.argv.includes('--output-dir') ? process.argv[process.argv.indexOf('--output-dir') + 1] : 'data/research/t0-data-replay-gate-v1/run-2026-08-02');
const costPolicy = JSON.parse(fs.readFileSync(path.join(root, 'research/t0-v1/cost-policy.json'), 'utf8'));
const t0Spec = JSON.parse(fs.readFileSync(path.join(root, 'research/t0-v1/t0-final-spec.json'), 'utf8'));
const result = auditT0Replay({
  archiveDir: path.join(root, 'data/intraday/archive'),
  pp1ArtifactsDir: path.join(root, 'data/pp1-market-semantics/run-2026-08-01-v3/artifacts'),
  costPolicy,
  t0Spec,
});

fs.mkdirSync(outputDir, { recursive: true });
const evidencePath = path.join(outputDir, 'T0_DATA_REPLAY_GATE.json');
const reportPath = path.join(outputDir, 'T0_DATA_REPLAY_GATE_REPORT.md');
fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
const c = result.counts;
const p = result.productAvailability;
const mismatchLines = result.mismatches.length
  ? result.mismatches.map((row) => `| ${row.tradeDate} | ${row.replayContractCode} | ${row.pp1SelectedResearchContractCode || '—'} | ${row.settlementClass} | ${row.noSampleReason} |`).join('\n')
  : '| — | — | — | — | 無 |';
const markdown = `# T0 Data／Replay Gate v1\n\n` +
`- 狀態：**${result.overallGateStatus}**\n` +
`- Cost Policy Hash：\`${result.costPolicyHash}\`\n` +
`- Tax Source Hash：\`${result.taxSourceHash}\`\n` +
`- T0 Spec Hash：\`${result.t0SpecHash}\`\n` +
`- PP-1 Policy Hash：\`${result.pp1PolicySpecHash}\`\n` +
`- formalWeight=0；researchOnly=true；executionAuthorized=false。\n\n` +
`## 滑價政策\n\n` +
`| 視圖 | 每邊ticks | T0主要H0 |\n|---|---:|---|\n` +
costPolicy.costViews.map((row) => `| ${row.viewId} | ${row.slippageTicksPerSide} | ${row.primaryH0View ? '是' : '否'} |`).join('\n') + `\n\n` +
`Gap穿越Stop時，以第一個合法不利成交價為基準，再疊加各情境滑價；不得使用Stop價取代。\n\n` +
`## 樣本盤點\n\n` +
`| 類別 | Session數 |\n|---|---:|\n` +
`| 全部日盤重播 | ${c.totalDaySessions} |\n| 一般日 | ${c.normalSessions} |\n| 合法結算日 | ${c.settlementSessions} |\n` +
`| 結算日／到期契約 | ${c.settlementFinalContractSessions} |\n| 結算日／非到期契約 | ${c.settlementNonFinalContractSessions} |\n` +
`| 結算狀態未知 | ${c.settlementStatusUnavailable} |\n| 換月Session | ${c.rollSessions} |\n| 目前符合全部凍結契約條件 | ${c.researchEligibleSessions} |\n\n` +
`## 商品資料可用性\n\n` +
`| 商品 | 真實重播Session | 狀態 |\n|---|---:|---|\n` +
`| TX | ${p.TX.actualReplaySessions} | 有真實TX重播；仍非成交驗證 |\n` +
`| MTX | ${p.MTX.actualReplaySessions} | 僅可成本情境，不得冒充MTX成交 |\n` +
`| TMF | ${p.TMF.actualReplaySessions} | 僅可成本情境，不得冒充TMF成交 |\n\n` +
`## 尚未通過的Session\n\n| 日期 | 重播契約 | PP-1研究契約 | 結算分類 | 原因 |\n|---|---|---|---|---|\n${mismatchLines}\n\n` +
`## 判定\n\n${result.gateMeaning}\n\n` +
`本Gate沒有執行T0歷史績效、沒有產生Signal或交易建議，也沒有授權Phase B。\n`;
fs.writeFileSync(reportPath, markdown, 'utf8');
const manifest = {
  runId: 't0-data-replay-gate-v1-2026-08-02',
  status: result.overallGateStatus,
  costPolicyHash: result.costPolicyHash,
  t0SpecHash: result.t0SpecHash,
  baseTicksPerSide: costPolicy.baseTicksPerSide,
  evidenceHash: hashJson(result),
  evidencePath: path.relative(root, evidencePath).replaceAll('\\', '/'),
  reportPath: path.relative(root, reportPath).replaceAll('\\', '/'),
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
fs.writeFileSync(path.join(outputDir, 'RUN_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...manifest, counts: result.counts, productAvailability: result.productAvailability }, null, 2));
process.exitCode = result.overallGateStatus === 'PASS' ? 0 : 2;
