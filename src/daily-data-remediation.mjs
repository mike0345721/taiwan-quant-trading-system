export const REMEDIATION_MATRIX_VERSION = 'GAP_REMEDIATION_MATRIX_V1';

const entries = [];
function group(codes, ownerLane, actionClass, canFixOffSession, needsTradingDay, needsOwnerDecision, smallestNextCheck, escalationCondition, blocks = [true, true, true]) {
  for (const reasonCode of codes.split(' ')) entries.push([reasonCode, Object.freeze({ reasonCode, ownerLane, actionClass,
    canFixOffSession, needsTradingDay, needsOwnerDecision, blocksCoreLive: blocks[0], blocksCoreEod: blocks[1], blocksResearch: blocks[2],
    smallestNextCheck, escalationCondition })]);
}
group('CAPTURE_GAP_UNEXPLAINED SUBSCRIPTION_NOT_READY QUOTE_TYPE_MISSING LEDGER_NOT_FOUND SOURCE_NOT_COLLECTED',
  'TRADING_DAY_CAPTURE', 'TRADING_DAY_CAPTURE_VERIFICATION', false, true, false,
  '下一個適用交易日核對 source → subscription → callback → writer → ledger；保存各層時間與身分。',
  '有實際適用時段證據仍缺資料時交 runtime lane；離線 fixture 不證明修復。');
group('LATE_START COMPUTER_NOT_READY_BEFORE_SESSION SCHEDULED_TASK_NOT_RUN',
  'STARTUP_OPERATIONS', 'STARTUP_SCHEDULING', false, true, false,
  '唯讀核對登入、既有排程紀錄、launcher 與第一筆事件；於適用交易日驗證啟動時序。',
  '修復需變更 startup/scheduler 時另交受控 lane；不得診斷成 source 故障。');

group('SCHEDULED_TASK_FAILED', 'DAILY_DATA_OPERATIONS', 'SCHEDULED_STAGE_DIAGNOSIS', true, false, false,
  '核對既有排程實際執行、失敗階段、來源發布與 writer 日誌；分別保留整批失敗及當日獨立合格資料。',
  '需切換正式 writer 或排程時走既定操作門檻；手動重跑成功不取代排程驗收。');
group('STALE_DELIVERY PROVIDER_RECONNECT CALLBACK_ERROR WRITER_ERROR QUEUE_DROP QUEUE_BACKLOG CONTINUITY_BREAK STALE_OR_DELAYED DUPLICATE_RATE_EXCEEDED VOLUME_RECONCILIATION_MISMATCH',
  'CRU49_RUNTIME_OR_SUCCESSOR', 'RUNTIME_CONTINUITY', false, true, false,
  '唯讀比對事件、callback、writer、ledger 與既有 runtime checkpoint；交 runtime lane 處理。',
  '需碰 producer/status/lock/collector 時 STOP_AND_ESCALATE_TO_OWNER；本包不修 runtime。');
group('ARTIFACT_IDENTITY_MISSING TIMESTAMP_LINEAGE_INSUFFICIENT SOURCE_INTEGRITY_NOT_VERIFIED ARTIFACT_NOT_WRITTEN BATCH_SCHEMA_UNVERIFIED BATCH_EVIDENCE_UNREADABLE SOURCE_NULL_SEMANTICS_UNVERIFIED EVIDENCE_AFTER_CUTOFF INPUT_ROW_MISSING INPUT_SESSION_NOT_EVALUATED CHECKPOINT_SESSION_EVIDENCE_UNAVAILABLE IMMUTABLE_CUTOFF_UNAVAILABLE',
  'OFFLINE_DATA_EVIDENCE', 'OFF_SESSION_EVIDENCE_HARDENING', true, false, false,
  '核對同日期 artifact/hash/原始 lineage 與固定 cutoff；缺證維持 UNKNOWN，不回填歷史 availableAt。',
  '既有證據不能唯一支持身分或時間語意時交資料治理，不補造證據。');
group('CANONICAL_DATASET_ID_UNAVAILABLE DUE_SEMANTICS_UNGOVERNED',
  'OWNER_DATA_GOVERNANCE', 'DATA_GOVERNANCE', false, false, true,
  '提出 canonical 身分或來源發布語意缺口，等待 Owner/data governance 決策。',
  '需新增 ID 或發布時間規則時另案批准；不是 collector 故障。', [false, true, true]);
group('NATIVE_SEQUENCE_UNAVAILABLE', 'PROVIDER_LIMITATION', 'ACCEPTED_PROVIDER_LIMITATION', false, false, false,
  '保留完整性／無漏包確定性 UNKNOWN；如需更強結論，提出獨立來源證據。',
  '研究要求更高完整性時另案評估；不得生成假 sequence。', [false, false, false]);
group('PROJECTION_NOT_READY WARMING_UP_WINDOW_INCOMPLETE RESEARCH_RULE_NOT_MET LONG_GAP_QUALITY_INSUFFICIENT DERIVED_ARTIFACT_UNREADABLE DERIVED_ARTIFACT_CHANGED_DURING_READ DERIVED_VALIDATION_FAILED DERIVED_OUTSIDE_IMMUTABLE_CUTOFF LIVE_ARTIFACT_IMMUTABILITY_UNPROVEN DERIVED_SOURCE_CUTOFF_UNVERIFIED DERIVED_ARTIFACT_SELECTION_AMBIGUOUS',
  'CRU34_CRU44_RESEARCH', 'RESEARCH_DERIVED', true, false, false,
  '核對同日期／時段／契約的既有研究 artifact 與資格；保留 raw capture 原狀。',
  '需改公式、門檻或新增 projection 時另案授權；離線只能核對已有證據。', [false, false, true]);
group('NOT_PUBLISHED_YET SESSION_NOT_ENDED', 'DATA_OPERATIONS', 'WAIT', false, false, false,
  '等候已治理的預期輸入或時段結束後，以新 cutoff 建立新評估版本。', '超過已治理期限仍無輸入時重新核對。', [false, false, false]);
group('MARKET_CLOSED NOT_IN_CURRENT_SCOPE', 'NONE', 'NONE', false, false, false,
  '合法不適用，不需修復。', '適用性改變時須有治理證據。', [false, false, false]);
group('NOT_ENABLED', 'OWNER', 'OWNER_SCOPE_CHANGE_ONLY', false, false, true,
  '維持未啟用；只有 Owner 新 scope 可啟用。', 'Owner 另案批准後再評估。', [false, false, false]);
group('LOW_DISK', 'STORAGE_OPERATIONS', 'CAPACITY_VERIFICATION', true, false, false,
  '核對真實 headroom 與多日 growth evidence。', '容量需變更保留政策時交 Owner。');
group('COVERAGE_PARTIAL ACTUAL_CONTRACT_MISMATCH TRADE_DATE_MISMATCH SESSION_MISMATCH API_NOT_READY',
  'DATA_EVIDENCE_TRIAGE', 'EVIDENCE_TRIAGE', true, false, false,
  '唯讀核對該列原始 reason、身分及上下游證據，不由泛用代碼猜測根因。',
  '需修改跨 lane 語意或 runtime 時停止並交 Owner。');

export const REMEDIATION_MATRIX = Object.freeze(Object.fromEntries(entries));
export function remediationFor(reasonCode, row = {}) {
  const match = REMEDIATION_MATRIX[reasonCode] || { reasonCode, ownerLane: 'DATA_GOVERNANCE', actionClass: 'UNMAPPED_REASON_REVIEW',
    canFixOffSession: false, needsTradingDay: false, needsOwnerDecision: true,
    blocksCoreLive: false, blocksCoreEod: false, blocksResearch: false,
    smallestNextCheck: '保留原始未知 reason；先核對來源契約，不能猜測修復。', escalationCondition: '新增 remediation 語意須先 review。' };
  return { ...match, blocksCoreLive: match.blocksCoreLive && row.blocksCoreLive === true,
    blocksCoreEod: match.blocksCoreEod && row.blocksCoreEod === true,
    blocksResearch: match.blocksResearch && row.blocksResearch === true };
}
