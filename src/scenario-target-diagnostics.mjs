import { hasSourceTimeGeometry, isStructureEligible } from './structural-eligibility.mjs';
// Explanations only. This module never selects/promotes a target, invents a price,
// changes a threshold, or decides whether a transaction should be placed.
const knownNumber = value => typeof value === 'number' && Number.isFinite(value);
const freeze = value => Object.freeze(value);

/** Describe exclusions in the *already validated and deduplicated* level universe.
 * Counts deliberately do not describe unreceived/unvalidated upstream references.
 */
export function explainScenarioTarget({ side, node, levels, target, threshold, chartQuality, structureEligibility } = {}) {
  if (!['LONG', 'SHORT'].includes(side)) throw Error('SCENARIO_DIAGNOSTIC_SIDE_REQUIRED');
  const label = side === 'LONG' ? '多方' : '空方';
  const beyond = price => side === 'LONG' ? price > threshold : price < threshold;
  const rows = (Array.isArray(levels) ? levels : []).filter(row => row && row.id !== node?.id && knownNumber(row.price));
  const reasons = [];
  const messages = [];
  const add = (code, text) => { reasons.push(code); messages.push(text); };
  const geometryReady=chartQuality==='PASS'||hasSourceTimeGeometry({qualityStatus:chartQuality,qualityReasons:['TIMESTAMP_LINEAGE_INSUFFICIENT'],structureEligibility});
  const thresholdReady = knownNumber(threshold) && isStructureEligible(node) && geometryReady;
  let directional = null, qualityRejected = null, contextRejected = null, eligible = null;

  if (!thresholdReady) {
    if (!geometryReady) add('CHART_QUALITY_INSUFFICIENT', '目前圖表資料品質未通過，無法建立可驗證的確認／失效門檻。');
    if (!isStructureEligible(node)) add('NODE_QUALITY_INSUFFICIENT', '目前觀察價位的品質未通過，不能當作已驗證的結構節點。');
    if (!reasons.length) add('THRESHOLD_UNAVAILABLE', '確認邊界尚不可用，不能判斷哪個價位符合方向目標。');
  } else {
    const outside = rows.filter(row => beyond(row.price));
    const goodQuality = outside.filter(row => isStructureEligible(row));
    const qualified = goodQuality.filter(row => row.importanceBand !== 'CONTEXT');
    directional = outside.length;
    qualityRejected = outside.length - goodQuality.length;
    contextRejected = goodQuality.length - qualified.length;
    eligible = qualified.length;
    if (!target) {
      if (!rows.length) add('NO_OTHER_VALIDATED_LEVEL', '目前經來源、時間檢查與合併後，沒有觀察節點以外的獨立參考價位。');
      else if (!outside.length) add('NO_LEVEL_BEYOND_CONFIRMATION', '目前可用價位集合中，沒有位於本側確認邊界之外的參考價位。');
      else {
        if (qualityRejected) add('DIRECTIONAL_LEVEL_QUALITY_INSUFFICIENT', `確認邊界外有 ${qualityRejected} 個參考價位未通過品質檢查，不能列為目標。`);
        if (contextRejected) add('DIRECTIONAL_LEVEL_CONTEXT_ONLY', `另有 ${contextRejected} 個品質通過的參考價位仍屬低優先級背景結構，不能升格為目標。`);
        if (eligible) add('ELIGIBLE_TARGET_NOT_SELECTED', '存在通過目前檢查的方向價位，但選取結果仍為空；需要檢查選取流程，而不是補造價位。');
      }
    }
  }
  const targetPresent = Boolean(target && knownNumber(target.price));
  // A present target does not repair missing thresholds or prove a trading edge.
  const state = !thresholdReady ? 'EVIDENCE_INCOMPLETE' : targetPresent ? 'TARGET_PRESENT'
    : eligible ? 'SELECTION_REQUIRES_REVIEW' : 'WAIT_QUALIFIED_TARGET';
  const waitFor = state === 'EVIDENCE_INCOMPLETE'
    ? '先恢復圖表與觀察節點的合格資料，再重新核對確認／失效門檻與目標。'
    : state === 'SELECTION_REQUIRES_REVIEW'
      ? '先核對選取流程；不要把此空值解讀成市場沒有延伸空間。'
      : targetPresent
        ? '仍需核對價格是否維持越過確認邊界，以及合格成交壓力與價格反應；目標存在不等於確認成立。'
        : reasons.includes('DIRECTIONAL_LEVEL_QUALITY_INSUFFICIENT')
          ? '等待方向價位通過品質檢查；其餘品質合格的節點只能繼續作反應觀察。'
          : reasons.includes('DIRECTIONAL_LEVEL_CONTEXT_ONLY')
            ? '等待獨立結構、共振或形成後有效反應達到既定規則；不要把局部轉折直接當目標。'
            : '等待目前價位集合補足或形成確認邊界外的合格結構；不外推行情會走到哪裡。';
  const summary = messages.length ? `${label}：${messages.join('')}` : `${label}：已有合格目標參考，但仍是條件觀察。`;
  return freeze({
    schemaVersion: 'scenario-target-diagnostics-v1', side, state,
    reasonCodes: freeze(reasons), summary, waitFor,
    universeScope: 'VALIDATED_DEDUPLICATED_LEVELS_NOT_ALL_MARKET_PRICES',
    counts: freeze({ otherLevels: rows.length, beyondConfirmation: directional,
      rejectedQuality: qualityRejected, rejectedContextOnly: contextRejected, eligible }),
    recommendation: false, changesSelection: false,
  });
}

/** Reuse the existing Next Watch explanation surface; never replace numeric data. */
export function observationOnlyGuidance(node, scenario) {
  if (!node || !scenario) return null;
  const sides = [scenario.long, scenario.short];
  const incomplete = sides.filter(side => side?.targetDiagnostics?.state !== 'TARGET_PRESENT');
  if (!incomplete.length) return null;
  const messages = incomplete.flatMap(side => side?.targetDiagnostics
    ? [side.targetDiagnostics.summary, side.targetDiagnostics.waitFor] : []);
  const noThresholds = incomplete.some(side => side?.targetDiagnostics?.state === 'EVIDENCE_INCOMPLETE');
  const prefix = noThresholds
    ? '資料不足：目前僅保留參考價位，不能用它確認方向或評估完整風報比。'
    : incomplete.length === 2
      ? '目前僅能觀察：多空兩側都缺少可驗證目標，尚不能完成風報比評估。'
      : '目前有一側缺少可驗證目標；該側尚不能完成風報比評估。';
  const watch = node.qualityStatus === 'PASS' && !noThresholds
    ? node.watchFor || node.expectedResponse || '繼續觀察節點附近的實際價格反應，不外推目標。'
    : '先等待資料品質與確認條件恢復；不要用未通過品質檢查的價位確認方向。';
  return freeze({ summary: prefix, explanation: messages.join(' '),
    watchFor: `${prefix} ${watch}`, basisReasons: freeze(messages), recommendation: false });
}
