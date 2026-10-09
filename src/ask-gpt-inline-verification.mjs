// Closed claim language, not a general natural-language truth checker. No model prose
// is rendered. Only backend-owned canonical explanations may accompany field facts.
// Never pass client/model-authored context here. Unsupported claims fail closed.
import { createHash } from 'node:crypto';
import { PlanError } from './chatgpt-plan-auth.mjs';

export const CONTENT_SCHEMA = 'ask-gpt-verified-claims-v1';
const fail = reason => { throw new PlanError('CONTENT_' + reason); };
const digest = value => createHash('sha256').update(value).digest('hex');
const get = (value, field) => field.split('.').reduce((v, k) => v && Object.hasOwn(v, k) ? v[k] : null, value) ?? null;
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const numeric = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const rounded = value => Number(value.toFixed(2));
const display = value => value === null ? '未知／不可用' : String(rounded(value));
const directionLabels = new Map([
  [null, '方向狀態未知'], ['UNAVAILABLE', '方向狀態不可用'],
  ['BIDIRECTIONAL_WATCH', '雙向觀察，方向未定；尚不能稱為雙向測試'],
  ['BIDIRECTIONAL_TEST', '雙向測試，方向未定'],
]);
const nodeLabels = new Map([
  [null, '未知'], ['UNAVAILABLE', '不可用'], ['MONITORING', '持續觀察，尚未進入測試'],
  ['APPROACHING', '接近節點'], ['TESTING', '測試中'], ['BREAKING', '穿越中'],
  ['ACCEPTED', '已出現節點接受型態'], ['REJECTED', '已出現節點拒絕型態'],
  ['RECLAIMED', '已出現重新站回型態'], ['LOST', '已出現跌破型態'],
]);
const scenarioLabels = new Map([
  [null, '未知'], ['UNAVAILABLE', '不可用'], ['WAIT_CONFIRMATION', '等待確認'],
  ['PRICE_CONFIRMATION_CANDIDATE', '僅價格條件候選，尚非方向確認'],
]);
const flowLabels = new Map([
  [null, '未知'], ['UNAVAILABLE', '不可用'], ['QUALITY_INSUFFICIENT', '品質不足'],
  ['ALIGNED', '當下反應同向，尚非方向確認'], ['CONTRARY', '當下反應反向'], ['MIXED', '反應混合'],
]);

// Compare with the frozen snapshot, not wall time: recovery must be deterministic.
const currentAt = (context, at) => at == null || (Number.isFinite(Date.parse(at))
  && Number.isFinite(Date.parse(context.snapshotTime)) && Date.parse(at) <= Date.parse(context.snapshotTime)
  && Date.parse(context.snapshotTime) - Date.parse(at) <= 120000);
const watchReady = context => context.levelWatch?.state === 'READY' && currentAt(context, context.levelWatch.sourceAvailableAt);

function fields(context) {
  const rows = new Map();
  const number = (field, label, unit, usable) => {
    const raw = get(context, field);
    rows.set(field, { label, unit, value: usable && numeric(raw) ? raw : null });
  };
  const state = (field, label, labels) => {
    const value = get(context, field);
    if (!labels.has(value)) fail('CONTEXT_UNSUPPORTED');
    rows.set(field, { label, labels, value });
  };
  number('price.value', '快照價格', 'price', context.price?.availability === 'AVAILABLE');
  number('VWAP.value', 'VWAP', 'price', context.VWAP?.availability === 'AVAILABLE');
  for (const [key, label] of [['high', '開盤區間上緣'], ['low', '開盤區間下緣']]) {
    number('OR.value.' + key, label, 'price', context.OR?.availability === 'AVAILABLE');
  }
  const watch = context.levelWatch;
  const ready = watchReady(context);
  const scenario = watch?.scenarioWatch;
  number('levelWatch.scenarioWatch.node.price', '情境觀察節點', 'price', ready && scenario?.node?.qualityStatus === 'PASS');
  number('levelWatch.nextWatch.price', '下一觀察節點', 'price', ready && watch?.nextWatch?.qualityStatus === 'PASS');
  for (const [side, label] of [['long', '多方'], ['short', '空方']]) {
    const prefix = 'levelWatch.scenarioWatch.' + side;
    const s = scenario?.[side];
    const usable = ready && scenario?.node?.qualityStatus === 'PASS' && ['WAIT_CONFIRMATION', 'PRICE_CONFIRMATION_CANDIDATE'].includes(s?.state);
    state(prefix + '.state', label + '情境', scenarioLabels);
    state(prefix + '.flowConfirmationState', label + '成交反應', flowLabels);
    number(prefix + '.confirmationThreshold', label + '條件式確認門檻（不代表已成立）', 'price', usable);
    number(prefix + '.invalidationThreshold', label + '條件式失效門檻', 'price', usable);
    number(prefix + '.target.price', label + '條件式結構目標', 'price', usable && s?.target?.qualityStatus === 'PASS' && s.target.importanceBand !== 'CONTEXT');
    const rrUsable = usable && s?.target?.qualityStatus === 'PASS' && s.target.importanceBand !== 'CONTEXT'
      && numeric(s.target.price) && numeric(s.confirmationThreshold) && numeric(s.invalidationThreshold);
    for (const [key, name, unit] of [['ratio', 'R:R', 'ratio'], ['riskPoints', '風險距離', 'points'], ['rewardPoints', '報酬距離', 'points']]) {
      number(prefix + '.rr.' + key, label + '條件式結構' + name, unit, rrUsable && s?.rr?.state === 'AVAILABLE');
    }
  }
  const flow = watch?.observedFlow;
  const flowUsable = ready && flow?.sourceState === 'LIVE' && flow.quality === 'PASS'
    && flow.availableAt != null && currentAt(context, flow.availableAt);
  number('levelWatch.observedFlow.pressure60', '當下成交壓力比', 'ratio', flowUsable);
  number('levelWatch.observedFlow.response60', '當下價格位移', 'points', flowUsable);
  number('marketPulse.rvol.ratio', '完成 K 的相對量能', 'ratio', context.marketPulse?.rvol?.state === 'READY');
  return rows;
}

export const DECISION_HEADINGS = Object.freeze(['現在怎麼看', '核心決策節點', '多方情境', '空方情境', '觀望條件', '條件式結構 R:R', '現在不要做什麼', '資料限制']);

// These strings originate in decision-level-watch, never in the model response.
// Prose is qualitative unless a condition's number matches its own catalog field.
// Never validate numeric text by membership in unrelated fields.
// Output remains plain text; the browser must use textContent, never innerHTML.
function explanation(value, boundNumber = null) {
  if (value == null || value === '') return '未提供／不可驗證';
  if (typeof value !== 'string' || value.length > 1000 || /[\p{Cc}\p{Cf}]/u.test(value)) fail('CONTEXT_TEXT_UNSAFE');
  // Producer drift into an execution directive is not a lawful explanation.
  if (/\b(?:BUY|SELL)\b|買入|買進|賣出|下單|加碼|建議進場|多方已確認|空方已確認/i.test(value)) fail('CONTEXT_TEXT_UNSAFE');
  return value.replace(/已完成5分K/g, '已完成 K').replace(/近期5分K/g, '近期完成 K')
    .replace(/單一/g, '單次').replace(/另一側/g, '對側').replace(/一側/g, '某側').replace(/前一交易日/g, '前個交易日')
    // Chinese financial numerals are also ordinary characters in words such as
    // 參考/參與. Redact number runs or counted units, not those words.
    .replace(/[零〇一二三四五六七八九十百千萬億兆壹貳參肆伍陸柒捌玖拾佰仟]{2,}|[零〇一二三四五六七八九十百千萬億兆壹貳參肆伍陸柒捌玖拾佰仟](?=點|元|倍|次|成|％|%)/gu, '〔數值略〕')
    .replace(/-?[\p{N}]+(?:[.,:+−–—\/-][\p{N}]+)*/gu,
      token => numeric(boundNumber) && /^-?\d+(?:\.\d+)?$/.test(token)
        && (Number(token) === boundNumber || Number(token) === rounded(boundNumber)) ? display(boundNumber) : '〔數值略〕');
}
const qualityLabels = new Map(Object.entries({ PASS: '合格（PASS）', READY: '就緒但非 PASS', QUALITY_INSUFFICIENT: '品質不足',
  UNAVAILABLE: '不可用', STALE: '過期', PARTIAL: '部分資料', DEGRADED: '品質降級', LIVE: '即時', FRESH: '新鮮' }));
const qualityText = value => qualityLabels.get(value) || '未知／不可用';
const timeText = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) ? value : '未知／不可用';

function renderDecision(context, catalog, direction, nodeState, comparisons) {
  const watch = context.levelWatch, scenario = watch?.scenarioWatch;
  const ready = watchReady(context);
  const node = scenario?.node;
  const nodeUsable = catalog.get('levelWatch.scenarioWatch.node.price').value !== null;
  const next = watch?.nextWatch;
  const nextUsable = catalog.get('levelWatch.nextWatch.price').value !== null;
  // Expected response belongs to the same node; never borrow another level's prose.
  const detail = node?.id != null ? [next, ...(watch?.levels || [])].find(r => r?.id === node.id && r.price === node.price) : null;
  const fact = field => {
    const r = catalog.get(field);
    return r.label + '：' + (r.labels ? r.labels.get(r.value) : display(r.value)) + '。';
  };
  const reasons = level => [explanation(level?.why), ...(level?.basisReasons || [])
    .filter(value => typeof value !== 'string' || !value.startsWith('形成／可用時間：'))
    .map(value => explanation(value))].join('；');
  const flow = watch?.observedFlow;
  const flowKnown = catalog.get('levelWatch.observedFlow.pressure60').value !== null && catalog.get('levelWatch.observedFlow.response60').value !== null;
  const flowSummary = `Flow 品質：${qualityText(flow?.quality)}；來源：${qualityText(flow?.sourceState)}。`
    + (flowKnown ? fact('levelWatch.observedFlow.pressure60') + fact('levelWatch.observedFlow.response60')
      + (flow.pressure60 > 0 ? '買方壓力' : flow.pressure60 < 0 ? '賣方壓力' : '壓力平衡')
      + '／' + (flow.response60 > 0 ? '價格上移' : flow.response60 < 0 ? '價格下移' : '價格持平') + '；僅當下描述，尚非持續確認。'
      : '實際成交／價格反應不可用，不可作方向確認。');
  const sideText = (side, label) => {
    const prefix = 'levelWatch.scenarioWatch.' + side, s = scenario?.[side];
    const usable = catalog.get(prefix + '.confirmationThreshold').value !== null;
    return `${label}：${ready ? scenarioLabels.get(s?.state ?? null) : '不可用'}；Flow 確認品質：${ready ? flowLabels.get(s?.flowConfirmationState ?? null) : '不可用'}。`
      + fact(prefix + '.confirmationThreshold')
      + `確認 Confirm（後端受控條件）：${usable ? explanation(s?.confirm, catalog.get(prefix + '.confirmationThreshold').value) : '不可用'}。`
      + fact(prefix + '.invalidationThreshold')
      + `失效 Invalidate（後端受控條件）：${catalog.get(prefix + '.invalidationThreshold').value !== null ? explanation(s?.invalidate, catalog.get(prefix + '.invalidationThreshold').value) : '不可用'}。`
      + fact(prefix + '.target.price')
      + (catalog.get(prefix + '.target.price').value !== null ? `下一關理由：${reasons(s.target)}。` : '尚無合格下一關，不外推目標。');
  };
  const warnings = (context.dataHealthWarnings || []).map(w => `資料警示：新鮮度 ${qualityText(w.freshness)}／品質 ${qualityText(w.quality)}；原因 ${explanation(w.reasonCode)}；availableAt ${timeText(w.availableAt)}。`);
  const bodies = [
    `${ready ? directionLabels.get(direction) : '方向狀態不可用'}。節點狀態：${ready ? nodeLabels.get(nodeState) : '不可用'}。不確定性：單一快照不能證明持續接受或多空確認。${flowSummary}\n${fact('price.value')}${fact('VWAP.value')}${comparisons.join('\n')}`,
    `${fact('levelWatch.scenarioWatch.node.price')}節點品質：${qualityText(node?.qualityStatus)}。為什麼重要（後端受控理由）：${nodeUsable ? reasons(node) : '不可用'}。\n預期價格反應 Expected：${nodeUsable ? explanation(node?.expectedResponse ?? detail?.expectedResponse) : '不可用'}。實際反應 Actual：${flowSummary}\n${fact('levelWatch.nextWatch.price')}下一觀察理由：${nextUsable ? next?.id != null && next.id === node?.id && next.price === node.price ? '與核心節點相同，理由見上' : reasons(next) : '不可用'}。`,
    sideText('long', 'Long 多方'), sideText('short', 'Short 空方'),
    '確認與失效條件須連同價格能否維持、壓力與價格反應一起觀察。Flow 品質不足、反應混合或門檻未知時，維持觀望；未達條件不能稱為方向確認。',
    ['long', 'short'].map(side => ['ratio', 'riskPoints', 'rewardPoints'].map(key => fact(`levelWatch.scenarioWatch.${side}.rr.${key}`)).join('')).join('\n')
      + '僅引用後端條件式幾何距離與比例，不是勝率、EV、進場價或停損指令。',
    '不要把觀察當測試、價格候選當多空確認、結構目標當必達價位；不要以缺值補零或自行推算目標。不提供買賣建議。',
    `未知保持未知。後端受控說明不是模型自由文字；未綁定欄位的說明數字省略，數值只依合格欄位呈現。節點 availableAt：${timeText(node?.availableAt)}；Flow availableAt：${timeText(flow?.availableAt)}。\n`
      + `整體 Flow 品質：${qualityText(context.observedFlow?.quality?.status)}；原因：${explanation(context.observedFlow?.quality?.reason ?? context.observedFlow?.unavailableReason)}。`
      + (context.observedFlow?.quality?.reasons || []).map(value => explanation(value)).join('；') + warnings.join('\n'),
  ];
  return DECISION_HEADINGS.map((heading, index) => heading + '：' + bodies[index]).join('\n').replace(/。；/g, '；').replace(/。{2,}/g, '。');
}

export function analysisContentContract(context) {
  return {
    schema: CONTENT_SCHEMA,
    keys: ['schema', 'directionState', 'nodeState', 'facts', 'comparisons'],
    directionState: 'Copy levelWatch.scenarioWatch.directionState exactly; null if absent.',
    nodeState: 'Copy levelWatch.scenarioWatch.node.state exactly; null if absent.',
    facts: 'Array of {field,value}; include price.value and VWAP.value. Numbers exact or rounded to two decimals; unavailable numbers must be null. States exact or null. No labels or prose.',
    fields: [...fields(context)].map(([field, row]) => ({ field, type: row.labels ? 'state' : row.unit, expected: row.value })),
    comparisons: 'Array of {left,operator,right}; left/right are price field paths present in facts; operator is ABOVE, BELOW or EQUAL. Compare unrounded context values. Empty array if unsure.',
  };
}

export function verifyAnalysisContent(raw, context) {
  if (!context || context.schemaVersion !== 'ask-gpt-inline-context-v1') fail('CONTEXT_UNSUPPORTED');
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 12000) fail('FORMAT_INVALID');
  let answer;
  try { answer = JSON.parse(raw); } catch { fail('FORMAT_INVALID'); }
  if (!exactKeys(answer, ['schema', 'directionState', 'nodeState', 'facts', 'comparisons']) || answer.schema !== CONTENT_SCHEMA) fail('FORMAT_INVALID');
  // Reject duplicate JSON keys and alternate numeric lexemes (exponents, -0,
  // overflow, escaped claims). They must not disappear silently in JSON.parse.
  let compact = '', quoted = false, escaped = false;
  for (const char of raw) {
    if (quoted || !/\s/.test(char)) compact += char;
    if (escaped) escaped = false;
    else if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
  }
  // Trailing decimal zeros are unambiguous (100.00 === 100). Normalize only
  // numeric tokens, leaving strings, exponent notation and excess precision intact.
  compact = compact.replace(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)\.\d+(?:[eE][+-]?\d+)?/g,
    token => token.startsWith('"') || /[eE]/.test(token) ? token : token.replace(/0+$/, '').replace(/\.$/, ''));
  if (compact !== JSON.stringify(answer)) fail('AMBIGUOUS_ENCODING');
  const direction = get(context, 'levelWatch.scenarioWatch.directionState');
  const node = get(context, 'levelWatch.scenarioWatch.node.state');
  if (!directionLabels.has(direction) || !nodeLabels.has(node)) fail('CONTEXT_UNSUPPORTED');
  if (answer.directionState !== direction || answer.nodeState !== node) fail('STATE_MISMATCH');
  if (!Array.isArray(answer.facts) || answer.facts.length < 2 || answer.facts.length > 30
    || !Array.isArray(answer.comparisons) || answer.comparisons.length > 8) fail('FORMAT_INVALID');
  const catalog = fields(context), seen = new Set(), lines = [];
  for (const fact of answer.facts) {
    if (!exactKeys(fact, ['field', 'value']) || typeof fact.field !== 'string' || !catalog.has(fact.field) || seen.has(fact.field)) fail('FIELD_AMBIGUOUS');
    seen.add(fact.field);
    const source = catalog.get(fact.field);
    if (source.labels) {
      if (fact.value !== source.value) fail('STATE_MISMATCH');
    } else if (source.value === null ? fact.value !== null
      : !numeric(fact.value) || (fact.value !== source.value && fact.value !== rounded(source.value))) fail('FACT_MISMATCH');
  }
  if (!seen.has('price.value') || !seen.has('VWAP.value')) fail('REQUIRED_FACT_MISSING');
  const relations = new Map([['ABOVE', '高於'], ['BELOW', '低於'], ['EQUAL', '等於']]);
  for (const comparison of answer.comparisons) {
    if (!exactKeys(comparison, ['left', 'operator', 'right']) || !relations.has(comparison.operator)
      || !seen.has(comparison.left) || !seen.has(comparison.right) || comparison.left === comparison.right) fail('COMPARISON_AMBIGUOUS');
    const left = catalog.get(comparison.left), right = catalog.get(comparison.right);
    if (left.unit !== 'price' || right.unit !== 'price' || left.value === null || right.value === null) fail('COMPARISON_AMBIGUOUS');
    const expected = left.value > right.value ? 'ABOVE' : left.value < right.value ? 'BELOW' : 'EQUAL';
    if (comparison.operator !== expected) fail('COMPARISON_MISMATCH');
    // If rounding obscures the ordering, show the original precision on both sides.
    const precise = rounded(left.value) === rounded(right.value) && left.value !== right.value;
    lines.push(`${left.label} ${precise ? left.value : display(left.value)} ${relations.get(expected)} ${right.label} ${precise ? right.value : display(right.value)}（僅本次快照的數值關係）。`);
  }
  const text = renderDecision(context, catalog, direction, node, lines);
  return { text, claims: answer, verification: { schema: CONTENT_SCHEMA, status: 'PASSED', contextHash: digest(JSON.stringify(context)), textHash: digest(text), scope: 'CLOSED_FIELD_CLAIMS_AND_CANONICAL_DECISION_V1' } };
}

// Recovery also checks content, rather than trusting a saved COMPLETED or PASSED
// marker. Legacy/unverified receipts are suppressed without rewriting old evidence.
export function verifiedReceiptText(receipt) {
  if (!receipt.contentVerification || !receipt.validatedClaims) fail('UNVERIFIED_RECEIPT');
  const result = verifyAnalysisContent(JSON.stringify(receipt.validatedClaims), receipt.context);
  const expected = result.verification, saved = receipt.contentVerification;
  if (receipt.contextHash !== expected.contextHash || receipt.text !== result.text
    || saved.schema !== expected.schema || saved.status !== 'PASSED'
    || saved.scope !== expected.scope || saved.contextHash !== expected.contextHash || saved.textHash !== expected.textHash) fail('UNVERIFIED_RECEIPT');
  return result.text;
}
