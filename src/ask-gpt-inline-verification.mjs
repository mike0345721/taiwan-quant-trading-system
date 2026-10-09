// Closed claim language, not a general natural-language truth checker. No model prose
// or context-supplied labels are rendered. Unsupported/ambiguous claims fail closed.
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
  const ready = watch?.state === 'READY';
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
    for (const [key, name, unit] of [['ratio', 'R:R', 'ratio'], ['riskPoints', '風險距離', 'points'], ['rewardPoints', '報酬距離', 'points']]) {
      number(prefix + '.rr.' + key, label + '條件式結構' + name, unit, usable && s?.rr?.state === 'AVAILABLE');
    }
  }
  number('marketPulse.rvol.ratio', '完成 K 的相對量能', 'ratio', context.marketPulse?.rvol?.state === 'READY');
  return rows;
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
    lines.push(source.label + '：' + (source.labels ? source.labels.get(source.value) : display(source.value)) + '。');
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
  const text = [
    '現在怎麼看：' + directionLabels.get(direction) + '。節點狀態：' + nodeLabels.get(node) + '。',
    ...lines,
    '觀望條件：條件式門檻與目標僅供觀察；單一快照無法證明價格能維持或趨勢持續，也不構成多空方向確認。',
    '資料限制：未知保持未知；未列入的資料不作推論。條件式結構 R:R 只引用已提供的幾何比例，不是勝率、EV、進場價或停損指令。不提供買賣建議。',
  ].join('\n');
  return { text, claims: answer, verification: { schema: CONTENT_SCHEMA, status: 'PASSED', contextHash: digest(JSON.stringify(context)), textHash: digest(text), scope: 'CLOSED_FIELD_CLAIMS_ONLY' } };
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
