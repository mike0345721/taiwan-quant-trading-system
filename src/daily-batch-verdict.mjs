// WP 0-6: split one daily batch into two conclusions.
//   todayIngestion  – did today's sources arrive and get written? Drives the scheduler exit code.
//   historicalAudit – history quality / continuity audits. Still run and still FAIL as before.
// The release gate in daily-update-gates.mjs is unchanged; this only reports.

export const SOURCE_STAGES = Object.freeze({
  taifex: '期交所日資料下載', intraday_replay: '5 分鐘官方回放', twse_gaps: '現貨法人補齊', twse_margin: '融資融券',
  futures_positions: '法人期貨部位', domestic_institutions: '投信與自營商明細', spot_institution_gross: '現貨法人買賣',
  option_institutions: '選擇權法人', option_large_traders: '選擇權大額交易人', market_breadth: '上市櫃市場廣度',
  securities_lending: '借券資料', global_context: '海外市場', macro_context: '總體環境', taiwan_vix: '臺指波動率',
});
export const DERIVE_STAGES = Object.freeze({
  prepare: '準備資料庫', intraday_features: '盤中特徵重建', intraday_strategy_engineering: '策略工程整理',
  normalized_futures_oi: '期貨 OI 口徑', option_volatility: '選擇權波動', volatility_relative: '相對波動',
  basis_term_structure: '基差與期限結構', features: '日資料特徵', status: '資料狀態摘要',
});
export const AUDIT_STAGES = Object.freeze({
  quality: '資料品質報告', official_validation: '官方一致性', available_at_audit: '資料可用時間稽核',
  extended_quality_audit: '擴充品質稽核', v362_gate_audit: '研究資料閘門', forward_decisions: '前推判斷',
  forward_outcomes: '前推結果', v34_forward: 'V3.4 前推追蹤', forward_ledger_audit: '前推帳本稽核',
  paper_event_ledger_audit: '紙上帳本稽核', live_event_ledger_audit: '即時帳本稽核', data_continuity_audit: '資料連續性稽核',
});

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000; // Taiwan has no daylight saving.
function taipei(value, withDate = true) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms + TAIPEI_OFFSET_MS).toISOString();
  return withDate ? `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}` : iso.slice(11, 16);
}
const shortDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : null;

export function stageFailureText(error) {
  const text = String(error ?? '');
  if (/ETIMEDOUT|timeout/i.test(text)) return '逾時';
  const exit = /exit_(\d+)/.exec(text);
  if (exit) return `程式回報錯誤，代碼 ${exit[1]}`;
  return text ? '執行失敗' : '原因未知';
}

// Same evidence as the release gate, but a source that is not yet due is not counted as missing.
export function requiredSourceState(marketDaily) {
  const m = marketDaily || {};
  if (m.status === 'NOT_EXPECTED') return { state: 'NOT_EXPECTED', dataThrough: null };
  if (m.status === 'VALID') return { state: 'OK', dataThrough: m.tradeDate || null };
  if (m.status === 'MISSING' && m.dueState === 'NOT_DUE') {
    return m.completedDateRow?.status === 'PRESENT'
      ? { state: 'OK', dataThrough: m.expectedCompletedTradeDate || null, notDue: true }
      : { state: 'MISSING', dataThrough: null, notDue: true, missingDate: m.expectedCompletedTradeDate || null };
  }
  if (m.status === 'MISSING') return { state: 'MISSING', dataThrough: null, missingDate: m.tradeDate || null };
  return { state: 'UNKNOWN', dataThrough: null };
}

export function buildDailyBatchVerdict(status) {
  if (!status || typeof status !== 'object') {
    const unknown = { state: 'UNKNOWN', exitCode: 1, line: '今日資料：讀不到每日批次的狀態檔。', missing: [] };
    return { todayIngestion: unknown, historicalAudit: { state: 'UNKNOWN', failed: [], notRun: [], line: '歷史稽核：沒有結果。' } };
  }
  const stages = Array.isArray(status.stages) ? status.stages : [];
  const byKey = new Map(stages.map(stage => [stage.key, stage]));
  const running = status.state === 'running';
  const finished = !running && Boolean(status.completedAt);
  const marketDaily = status.gateSummary?.marketDaily;
  const required = requiredSourceState(marketDaily);
  const when = taipei(status.startedAt);
  const suffix = when ? `（${when} 批次）` : '';

  const failedOf = (group) => Object.entries(group).flatMap(([key, label]) => {
    const stage = byKey.get(key);
    if (stage && stage.ok === false) return [{ key, label, reason: stageFailureText(stage.error) }];
    if (!stage && finished) return [{ key, label, reason: '未執行（批次提早中止）', notRun: true }];
    return [];
  });
  const missing = failedOf(SOURCE_STAGES).map(item => item.key === 'taifex' && required.state === 'OK'
    ? { ...item, reason: `${item.reason}；期貨日 K 已入庫，其他期交所資料可能不完整` } : item);
  const deriveFailed = failedOf(DERIVE_STAGES);
  const audit = failedOf(AUDIT_STAGES);

  let state;
  if (running) state = 'RUNNING';
  else if (required.state === 'MISSING' || deriveFailed.length) state = 'FAILED';
  else if (required.state === 'UNKNOWN') state = 'UNKNOWN';
  else if (missing.length) state = 'PARTIAL';
  else state = required.state === 'NOT_EXPECTED' ? 'NOT_EXPECTED' : 'PASS';

  const through = shortDate(required.dataThrough);
  const missingText = items => items.map(item => `${item.label}（${item.reason}）`).join('、');
  let line;
  if (state === 'RUNNING') line = `今日資料：批次執行中，已完成 ${stages.length}/${status.totalStages || '?'} 步${suffix}。`;
  else if (state === 'FAILED') {
    const parts = [];
    if (required.state === 'MISSING') parts.push(`期貨日 K ${shortDate(required.missingDate) || ''} 不在資料庫`.replace('  ', ' '));
    if (deriveFailed.length) parts.push(`整理步驟失敗：${missingText(deriveFailed)}`);
    if (missing.length) parts.push(`沒進來的來源：${missingText(missing)}`);
    line = `今日資料：沒有完成入庫——${parts.join('；')}${suffix}。`;
  } else if (state === 'UNKNOWN') line = `今日資料：無法確認期貨日 K 是否入庫（交易日曆或資料庫讀不到）${suffix}。`;
  else {
    const head = state === 'NOT_EXPECTED' ? '今天休市，不需要新資料' : `已入庫到 ${through || '日期未知'}`;
    const notDue = required.notDue ? '；今天日盤 13:45 收盤後才會有今日資料，不算缺漏' : '';
    const tail = missing.length ? `；${missing.length} 個來源沒進來：${missingText(missing)}` : '，所有來源正常';
    line = `今日資料：${head}${notDue}${tail}${suffix}。`;
  }

  const auditFailed = audit.filter(item => !item.notRun), auditNotRun = audit.filter(item => item.notRun);
  const auditState = running ? 'RUNNING' : auditFailed.length ? 'FAIL' : auditNotRun.length ? 'NOT_RUN' : finished ? 'PASS' : 'UNKNOWN';
  const auditLine = auditState === 'FAIL'
    ? `歷史稽核：未通過——${missingText(auditFailed)}${auditNotRun.length ? `；另有 ${auditNotRun.length} 項因提早中止未執行` : ''}。這是歷史資料的品質問題，和今日入庫分開判定，門檻沒有放寬。`
    : auditState === 'NOT_RUN' ? `歷史稽核：${auditNotRun.length} 項未執行（批次提早中止）。`
      : auditState === 'PASS' ? '歷史稽核：全部通過。' : auditState === 'RUNNING' ? '歷史稽核：等待批次跑完。' : '歷史稽核：沒有結果。';

  return {
    todayIngestion: { state, exitCode: ['FAILED', 'UNKNOWN'].includes(state) ? 1 : 0, targetTradeDate: status.targetTradeDate || null,
      dataThroughTradeDate: required.dataThrough, requiredSource: required.state, notDue: Boolean(required.notDue),
      missing, deriveFailed, line },
    historicalAudit: { state: auditState, failed: auditFailed, notRun: auditNotRun, line: auditLine },
  };
}
