import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import { Transform } from 'node:stream';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';

export const DAILY_COLLECTION_ACCEPTANCE_SCHEMA_VERSION = 'daily-collection-acceptance-v1';

export const DAILY_ACCEPTANCE_STATES = Object.freeze([
  'PASS', 'PARTIAL', 'FAIL', 'PENDING', 'NOT_EXPECTED', 'UNKNOWN',
]);

export const RESEARCH_ELIGIBILITY_STATES = Object.freeze([
  'READY', 'READY_WITH_LIMITATION', 'NOT_READY', 'NOT_APPLICABLE', 'UNKNOWN',
]);

export const REASON_ZH = Object.freeze({
  NOT_PUBLISHED_YET: '尚未發布',
  MARKET_CLOSED: '市場休市，當日不要求收集',
  NOT_ENABLED: '尚未啟用',
  NOT_IN_CURRENT_SCOPE: '不在本階段範圍',
  COMPUTER_NOT_READY_BEFORE_SESSION: '電腦未在盤前就緒',
  SCHEDULED_TASK_NOT_RUN: '排程工作未執行',
  LATE_START: '收集啟動時間過晚',
  SUBSCRIPTION_NOT_READY: '訂閱尚未就緒',
  QUOTE_TYPE_MISSING: '必要報價類型未收到',
  STALE_DELIVERY: '資料傳遞已過期',
  PROVIDER_RECONNECT: '供應商連線曾重新連接',
  CALLBACK_ERROR: '行情回呼發生錯誤',
  CAPTURE_GAP_UNEXPLAINED: '收集缺口待釐清',
  NATIVE_SEQUENCE_UNAVAILABLE: '供應商原生序號不可用，無法證明無漏包',
  WRITER_ERROR: '寫入程序發生錯誤',
  QUEUE_DROP: '寫入佇列有事件遺失',
  QUEUE_BACKLOG: '寫入佇列發生積壓',
  LOW_DISK: '磁碟可用空間不足',
  LEDGER_NOT_FOUND: '找不到當日事件帳本',
  ARTIFACT_NOT_WRITTEN: '驗收所需產物未寫入',
  ARTIFACT_IDENTITY_MISSING: '缺少可歸屬此資料集的產物身分',
  SOURCE_NOT_COLLECTED: '指定來源範圍未找到已收集資料',
  COVERAGE_PARTIAL: '證據僅涵蓋部分資料或時段',
  STALE_OR_DELAYED: '來源晚於截止時間或已過期',
  BATCH_SCHEMA_UNVERIFIED: '批次資料表結構尚未驗證',
  BATCH_EVIDENCE_UNREADABLE: '批次資料證據無法讀取',
  SOURCE_INTEGRITY_NOT_VERIFIED: '來源完整性尚未驗證',
  SOURCE_NULL_SEMANTICS_UNVERIFIED: '來源缺值語意尚未驗證',
  EVIDENCE_AFTER_CUTOFF: '證據取得時間晚於驗收截止時間',
  DERIVED_ARTIFACT_UNREADABLE: '投影檔案無法讀取',
  DERIVED_ARTIFACT_CHANGED_DURING_READ: '投影於讀取期間改變',
  DERIVED_VALIDATION_FAILED: '投影驗證未通過',
  DERIVED_OUTSIDE_IMMUTABLE_CUTOFF: '投影時間超出固定驗收截點',
  LIVE_ARTIFACT_IMMUTABILITY_UNPROVEN: '即時投影未具不可變歷史證據',
  DERIVED_SOURCE_CUTOFF_UNVERIFIED: '投影來源帳本截點尚未核實',
  DERIVED_ARTIFACT_SELECTION_AMBIGUOUS: '同時點投影身分無法唯一歸屬',
  ACTUAL_CONTRACT_MISMATCH: '實際契約身分不一致',
  TRADE_DATE_MISMATCH: '交易日身分不一致',
  SESSION_MISMATCH: '交易時段身分不一致',
  TIMESTAMP_LINEAGE_INSUFFICIENT: '時間戳來源鏈不足',
  DUPLICATE_RATE_EXCEEDED: '重複事件比例超過既有稽核門檻',
  VOLUME_RECONCILIATION_MISMATCH: '成交量對帳不一致',
  CONTINUITY_BREAK: '資料連續性曾中斷',
  LONG_GAP_QUALITY_INSUFFICIENT: '長時間缺口使研究品質不足',
  PROJECTION_NOT_READY: '研究投影尚未就緒',
  WARMING_UP_WINDOW_INCOMPLETE: '研究視窗仍在暖機',
  API_NOT_READY: '來源 API 尚未就緒',
  RESEARCH_RULE_NOT_MET: '研究使用規則未符合',
  CANONICAL_DATASET_ID_UNAVAILABLE: 'Master Data Requirements 尚無此 Feed 的 canonical Dataset ID',
});

const LIVE_FEEDS = Object.freeze([
  Object.freeze({ datasetId: 'tx_actual_trade', ownerLabelZh: '臺指期逐筆成交', technicalLabelEn: 'TX Tick', quoteType: 'Tick', family: 'TX', kind: 'futures_tick', sessions: ['DAY', 'NIGHT'], material: true }),
  Object.freeze({ datasetId: 'tx_best_quote', ownerLabelZh: '臺指期最佳買賣報價', technicalLabelEn: 'TX BidAsk', quoteType: 'BidAsk', family: 'TX', kind: 'futures_bidask', sessions: ['DAY', 'NIGHT'], material: true }),
  Object.freeze({ datasetId: null, ownerLabelZh: '小型臺指期逐筆成交', technicalLabelEn: 'MTX Tick', quoteType: 'Tick', family: 'MTX', kind: 'futures_tick', sessions: ['DAY', 'NIGHT'], material: false }),
  Object.freeze({ datasetId: null, ownerLabelZh: '小型臺指期最佳買賣報價', technicalLabelEn: 'MTX BidAsk', quoteType: 'BidAsk', family: 'MTX', kind: 'futures_bidask', sessions: ['DAY', 'NIGHT'], material: false }),
  Object.freeze({ datasetId: null, ownerLabelZh: '微型臺指期逐筆成交', technicalLabelEn: 'TMF Tick', quoteType: 'Tick', family: 'TMF', kind: 'futures_tick', sessions: ['DAY', 'NIGHT'], material: false }),
  Object.freeze({ datasetId: null, ownerLabelZh: '微型臺指期最佳買賣報價', technicalLabelEn: 'TMF BidAsk', quoteType: 'BidAsk', family: 'TMF', kind: 'futures_bidask', sessions: ['DAY', 'NIGHT'], material: false }),
  Object.freeze({ datasetId: 'equity_2330_raw_price', ownerLabelZh: '台積電 2330 即時成交', technicalLabelEn: '2330 live Tick', quoteType: 'Tick', family: '2330', kind: 'stock_tick', sessions: ['DAY'], material: false }),
  Object.freeze({ datasetId: 'taiex_index', ownerLabelZh: '發行量加權股價指數即時報價', technicalLabelEn: 'IX0001 live Quote', quoteType: 'Quote', family: 'IX0001', kind: 'index_quote', sessions: ['DAY'], material: false }),
]);

const BATCH_FEEDS = Object.freeze([
  Object.freeze({ datasetId: 'taifex_daily_market', ownerLabelZh: '期交所每日市場行情', technicalLabelEn: 'TAIFEX daily market', stageKey: 'taifex', material: true }),
  Object.freeze({ datasetId: 'tx_futures_oi', ownerLabelZh: '臺指期未平倉量', technicalLabelEn: 'TX futures OI', stageKey: 'futures_positions', material: true }),
  Object.freeze({ datasetId: 'tx_institutional_positions', ownerLabelZh: '臺指期法人部位', technicalLabelEn: 'TX institutional positions', stageKey: 'futures_positions', material: true }),
  Object.freeze({ datasetId: 'tx_large_trader', ownerLabelZh: '臺指期大額交易人', technicalLabelEn: 'TX large trader', stageKey: 'taifex', material: false }),
  Object.freeze({ datasetId: 'txo_strike_expiry_cp_oi', ownerLabelZh: '臺指選履約價到期別買賣權未平倉', technicalLabelEn: 'TXO strike/expiry/call-put OI', stageKey: 'taifex', material: true }),
  Object.freeze({ datasetId: 'market_breadth_and_sector_leadership', ownerLabelZh: '上市市場廣度與類股領先', technicalLabelEn: 'TWSE breadth batch', stageKey: 'market_breadth', material: false }),
]);

const FUTURE_FEEDS = Object.freeze([
  Object.freeze({ datasetId: 'txo_intraday_trade_quote_candidates', ownerLabelZh: '臺指選擇權盤中成交與報價候選', technicalLabelEn: 'TXO Live chain', quoteType: 'Tick/BidAsk' }),
  Object.freeze({ datasetId: 'twn_futures', ownerLabelZh: '富時臺灣指數期貨即時資料', technicalLabelEn: 'TWN Live', quoteType: 'Tick/BidAsk' }),
  Object.freeze({ datasetId: 'nq_futures', ownerLabelZh: '那斯達克 100 指數期貨即時資料', technicalLabelEn: 'NQ Live', quoteType: 'Tick/BidAsk' }),
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function registryMap(registry) {
  return new Map((registry?.datasets || []).map((item) => [item.dataset_id, item]));
}

function reasonZh(codes) {
  return codes.map((code) => REASON_ZH[code] || `尚無繁中說明（${code}）`);
}

function feedBase(definition, { calendarDate, tradeDate, session, expectedState, expectedWindow }) {
  return {
    datasetId: definition.datasetId,
    ownerLabelZh: definition.ownerLabelZh,
    technicalLabelEn: definition.technicalLabelEn,
    quoteType: definition.quoteType || 'Official batch',
    mode: definition.mode || (definition.kind ? 'LIVE_EVENT' : 'OFFICIAL_BATCH'),
    source: definition.kind ? 'Shioaji append-only live-event ledger' : 'Existing governed daily-update evidence',
    calendarDate,
    tradeDate,
    session,
    expectedState,
    expectedWindow,
    actualContract: null,
    firstReceivedAt: null,
    lastReceivedAt: null,
    recordCount: null,
    bytes: null,
    captureState: 'UNKNOWN',
    coverageState: 'UNKNOWN',
    persistenceState: 'UNKNOWN',
    integrityState: 'UNKNOWN',
    researchEligibility: 'UNKNOWN',
    reasonCodes: [],
    reasonZh: [],
    evidenceStrength: 'NONE',
    sourceArtifactIdentity: null,
    downstreamImpact: [],
    smallestNextCheck: '確認可追溯來源證據',
    material: definition.material === true,
  };
}

function closeFeed(feed) {
  const result = { ...feed, reasonCodes: unique(feed.reasonCodes) };
  result.reasonZh = reasonZh(result.reasonCodes);
  delete result.material;
  return Object.freeze(result);
}

function notExpectedFeed(definition, context, reasonCode) {
  return closeFeed({
    ...feedBase(definition, { ...context, expectedState: 'NOT_EXPECTED' }),
    captureState: 'NOT_EXPECTED',
    coverageState: 'NOT_EXPECTED',
    persistenceState: 'NOT_EXPECTED',
    integrityState: 'NOT_EXPECTED',
    researchEligibility: 'NOT_APPLICABLE',
    reasonCodes: [reasonCode],
    evidenceStrength: 'GOVERNED_SCOPE',
    smallestNextCheck: '不需修復；僅在另案授權後重新評估',
  });
}

function liveFeed(definition, session, context, evidence, registry) {
  if (context.marketDayState === 'NON_TRADING_DAY') {
    return notExpectedFeed(definition, { ...context, session, expectedWindow: session }, 'MARKET_CLOSED');
  }
  if (context.marketDayState !== 'TRADING_DAY') {
    return closeFeed({ ...feedBase(definition, { ...context, session, expectedState: 'UNKNOWN', expectedWindow: session }),
      reasonCodes: ['TIMESTAMP_LINEAGE_INSUFFICIENT'] });
  }
  if (!definition.sessions.includes(session)) {
    return notExpectedFeed(definition, { ...context, session, expectedWindow: session }, 'NOT_IN_CURRENT_SCOPE');
  }
  if (!context.sessions.includes(session)) {
    return notExpectedFeed(definition, { ...context, session, expectedWindow: session }, 'NOT_IN_CURRENT_SCOPE');
  }
  const key = `${definition.family}:${definition.kind}:${session}`;
  const item = evidence?.feeds?.[key] || null;
  const base = feedBase(definition, {
    ...context, session, expectedState: definition.datasetId ? 'REQUIRED' : 'UNKNOWN', expectedWindow: session,
  });
  const registryItem = registry.get(definition.datasetId);
  const familySessionWindow = session === 'DAY' && ['2330', 'IX0001'].includes(definition.family) ? {
    sessionStart: new Date(`${context.tradeDate}T09:00:00+08:00`).toISOString(),
    sessionEnd: new Date(`${context.tradeDate}T13:30:00+08:00`).toISOString(),
  } : null;
  const sessionWindow = familySessionWindow || evidence?.sessionWindows?.[session] || null;
  const generatedMs = Date.parse(context.generatedAt);
  const expectedSessionEndMs = Date.parse(sessionWindow?.sessionEnd || '');
  const sessionEvidence = evidence?.sessions?.[session] || {};
  const sessionMetric = (metric) => nullableNumber(sessionEvidence[metric]) ?? nullableNumber(evidence?.[metric]) ?? 0;
  const sessionMissingFiles = sessionEvidence.missingFiles || [];
  if (!evidence?.ledgerFound) {
    if (Number.isFinite(expectedSessionEndMs) && generatedMs < expectedSessionEndMs) {
      return closeFeed({
        ...base, captureState: 'PENDING', coverageState: 'PENDING', persistenceState: 'PENDING', integrityState: 'PENDING',
        researchEligibility: 'UNKNOWN', reasonCodes: ['NOT_PUBLISHED_YET'], evidenceStrength: 'GOVERNED_SESSION_WINDOW',
        sourceArtifactIdentity: evidence?.sourceArtifactIdentity || null,
        smallestNextCheck: `${session} session close 後重跑每日驗收`,
      });
    }
    if (sessionMissingFiles.length) {
      return closeFeed({
        ...base, recordCount: 0, bytes: 0, captureState: 'PARTIAL', persistenceState: 'PARTIAL',
        researchEligibility: 'NOT_READY', reasonCodes: ['LEDGER_NOT_FOUND'], evidenceStrength: 'BOUNDED_LEDGER_SCAN',
        sourceArtifactIdentity: evidence.sourceArtifactIdentity,
        downstreamImpact: [definition.datasetId, 'derived_pressure_response_efficiency'].filter(Boolean),
        smallestNextCheck: `確認 ${session} governed ledger 是否存在且含完整記錄`,
      });
    }
    return closeFeed({
      ...base, reasonCodes: ['LEDGER_NOT_FOUND'], sourceArtifactIdentity: evidence?.sourceArtifactIdentity || null,
      downstreamImpact: [definition.datasetId], smallestNextCheck: '確認指定 calendarDate 的唯讀 ledger 路徑',
    });
  }
  if (!item || item.recordCount === 0) {
    if (!definition.datasetId && !sessionMissingFiles.length) {
      return closeFeed({
        ...base, reasonCodes: ['CANONICAL_DATASET_ID_UNAVAILABLE'],
        sourceArtifactIdentity: evidence.sourceArtifactIdentity,
        smallestNextCheck: '先由資料治理建立 canonical Dataset ID，再決定 acceptance denominator',
      });
    }
    if (Number.isFinite(expectedSessionEndMs) && generatedMs < expectedSessionEndMs) {
      return closeFeed({
        ...base, recordCount: 0, bytes: 0, captureState: 'PENDING', coverageState: 'PENDING',
        persistenceState: 'PENDING', integrityState: 'PENDING', researchEligibility: 'UNKNOWN',
        reasonCodes: ['NOT_PUBLISHED_YET'], evidenceStrength: 'GOVERNED_SESSION_WINDOW',
        sourceArtifactIdentity: evidence.sourceArtifactIdentity,
        smallestNextCheck: `${session} session close 後重跑每日驗收`,
      });
    }
    if (sessionMissingFiles.length) {
      return closeFeed({
        ...base, recordCount: 0, bytes: 0, captureState: 'PARTIAL', persistenceState: 'PARTIAL',
        researchEligibility: 'NOT_READY',
        reasonCodes: ['LEDGER_NOT_FOUND', ...(!definition.datasetId ? ['CANONICAL_DATASET_ID_UNAVAILABLE'] : [])],
        evidenceStrength: 'BOUNDED_LEDGER_SCAN',
        sourceArtifactIdentity: evidence.sourceArtifactIdentity,
        downstreamImpact: [definition.datasetId, 'derived_pressure_response_efficiency'].filter(Boolean),
        smallestNextCheck: `確認 ${session} governed ledger 是否存在且含完整記錄`,
      });
    }
    return closeFeed({
      ...base, recordCount: 0, bytes: 0, captureState: 'FAIL', persistenceState: 'UNKNOWN',
      reasonCodes: ['CAPTURE_GAP_UNEXPLAINED'], evidenceStrength: 'BOUNDED_LEDGER_SCAN',
      sourceArtifactIdentity: evidence.sourceArtifactIdentity, downstreamImpact: [definition.datasetId],
      smallestNextCheck: `核對 ${definition.technicalLabelEn} 訂閱與 writer delivery evidence`,
    });
  }
  const reasons = [];
  if (!definition.datasetId) reasons.push('CANONICAL_DATASET_ID_UNAVAILABLE');
  if (item.contracts.length !== 1) reasons.push('ACTUAL_CONTRACT_MISMATCH');
  if (item.nativeSequenceAvailable !== true || item.nativeSequenceMissing === true) reasons.push('NATIVE_SEQUENCE_UNAVAILABLE');
  if (sessionMetric('callbackErrors') > 0) reasons.push('CALLBACK_ERROR');
  if (sessionMetric('writerErrors') > 0) reasons.push('WRITER_ERROR');
  if (sessionMetric('droppedEvents') > 0) reasons.push('QUEUE_DROP');
  if (sessionMetric('reconnectCount') > 0) reasons.push('PROVIDER_RECONNECT');
  if (sessionMissingFiles.length) reasons.push('LEDGER_NOT_FOUND');
  if (item.nativeSequenceGaps > 0) reasons.push('CONTINUITY_BREAK');
  if (item.invalidLines > 0) reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  const persistenceState = sessionMetric('writerErrors') > 0 || sessionMetric('droppedEvents') > 0 ? 'FAIL'
    : sessionMissingFiles.length ? 'PARTIAL' : 'PASS';
  const scopedAudit = Object.hasOwn(sessionEvidence, 'ledgerAudit') ? sessionEvidence.ledgerAudit : evidence.ledgerAudit;
  const knownIntegrityFailure = scopedAudit?.ok === false || item.nativeSequenceGaps > 0;
  const integrityState = knownIntegrityFailure ? 'FAIL'
    : scopedAudit?.ok === true && item.nativeSequenceAvailable === true
      && item.nativeSequenceMissing !== true && item.nativeSequenceGapUnknown !== true
      && item.nativeSequenceGaps === 0 && item.invalidLines === 0
      && sessionMetric('reconnectCount') === 0 ? 'PASS' : 'UNKNOWN';
  const captureState = item.contracts.length === 1 && sessionMetric('callbackErrors') === 0
    && !sessionMissingFiles.length ? 'PASS' : 'PARTIAL';
  const sessionStartMs = Date.parse(item.sessionStart || '');
  const sessionEndMs = Date.parse(item.sessionEnd || '');
  let coverageState = 'UNKNOWN';
  if (Number.isFinite(sessionStartMs) && Number.isFinite(sessionEndMs)) {
    if (generatedMs < sessionEndMs) coverageState = 'PENDING';
    else {
      const startsOnTime = Date.parse(item.firstReceivedAt) <= sessionStartMs;
      const reachesClose = Date.parse(item.lastReceivedAt) >= sessionEndMs;
      coverageState = startsOnTime && reachesClose ? 'PASS' : 'PARTIAL';
      if (!startsOnTime) reasons.push('LATE_START');
      if (!reachesClose) reasons.push('STALE_DELIVERY');
    }
  }
  const researchEligibility = !definition.datasetId || integrityState === 'FAIL' ? 'NOT_READY'
    : ['PENDING', 'UNKNOWN'].includes(coverageState) ? 'UNKNOWN'
    : coverageState === 'PASS' && captureState === 'PASS' && persistenceState === 'PASS'
      ? (integrityState === 'PASS' && registryItem?.quality_status === 'PASS' ? 'READY' : 'READY_WITH_LIMITATION')
      : 'NOT_READY';
  return closeFeed({
    ...base,
    calendarDate: item.calendarDates?.[0] || base.calendarDate,
    calendarDates: item.calendarDates || (item.firstReceivedAt ? [String(item.firstReceivedAt).slice(0, 10)] : []),
    actualContract: item.contracts.length === 1 ? item.contracts[0] : null,
    firstReceivedAt: item.firstReceivedAt,
    lastReceivedAt: item.lastReceivedAt,
    recordCount: item.recordCount,
    bytes: item.bytes,
    captureState,
    coverageState,
    persistenceState,
    integrityState,
    researchEligibility,
    reasonCodes: reasons,
    evidenceStrength: evidence.ledgerAudit ? 'LEDGER_AUDIT_PLUS_BOUNDED_SCAN' : 'BOUNDED_LEDGER_SCAN',
    sourceArtifactIdentity: evidence.sourceArtifactIdentity,
    downstreamImpact: researchEligibility === 'NOT_READY'
      ? [definition.datasetId, 'derived_pressure_response_efficiency'].filter(Boolean) : [],
    smallestNextCheck: !definition.datasetId
      ? '先由資料治理建立 canonical Dataset ID，再決定 research eligibility'
      : reasons.includes('NATIVE_SEQUENCE_UNAVAILABLE')
      ? '保留完整性 UNKNOWN；如需更強結論，另找獨立成交量或序列證據'
      : '核對當日 governed audit 與來源時間窗',
  });
}

function earliestBatchDueTime(tradeDate) {
  return Date.parse(`${tradeDate}T13:45:00+08:00`);
}

function validTimeAtCutoff(value, cutoff) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(cutoff);
}

function artifactIdentityPresent(identity) {
  return identity && /^[a-f0-9]{64}$/.test(identity.sha256 || '');
}

function batchFeed(definition, context, dailyStatus, datasetEvidence) {
  const base = feedBase(definition, { ...context, session: 'EOD', expectedState: 'REQUIRED', expectedWindow: '盤後官方發布後' });
  if (context.marketDayState === 'NON_TRADING_DAY') return notExpectedFeed(definition, { ...context, session: 'EOD', expectedWindow: '盤後官方發布後' }, 'MARKET_CLOSED');
  if (context.marketDayState !== 'TRADING_DAY') return closeFeed({ ...base, expectedState: 'UNKNOWN', reasonCodes: ['TIMESTAMP_LINEAGE_INSUFFICIENT'] });
  const stageValid = dailyStatus?.gateSummary?.marketDaily?.tradeDate === context.tradeDate
    && validTimeAtCutoff(dailyStatus?.completedAt, context.generatedAt);
  const stage = stageValid ? dailyStatus.stages?.find((item) => item.key === definition.stageKey) : null;
  const item = datasetEvidence;
  const sameDate = item?.datasetId === definition.datasetId && item?.sourceDate === context.tradeDate;
  const artifactKnown = sameDate && artifactIdentityPresent(item?.sourceArtifactIdentity);
  const observed = artifactKnown && validTimeAtCutoff(item?.observedAt, context.generatedAt);
  const timeBound = observed && item?.cutoffValidated === true && validTimeAtCutoff(item?.availableAt, context.generatedAt);
  if (!timeBound && Date.parse(context.generatedAt) < earliestBatchDueTime(context.tradeDate)) {
    return closeFeed({ ...base, expectedState: 'PENDING', captureState: 'PENDING', persistenceState: 'PENDING', integrityState: 'PENDING', researchEligibility: 'UNKNOWN', reasonCodes: ['NOT_PUBLISHED_YET'], evidenceStrength: 'GOVERNED_PUBLICATION_WINDOW' });
  }
  const reasons = [...(item?.reasonCodes || [])];
  if (!artifactKnown) reasons.push('ARTIFACT_IDENTITY_MISSING');
  if (item && !sameDate) reasons.push('TRADE_DATE_MISMATCH');
  if (!timeBound) reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  if (!item && !stage) reasons.push(dailyStatus && !stageValid ? 'TIMESTAMP_LINEAGE_INSUFFICIENT' : 'ARTIFACT_NOT_WRITTEN');
  if (stage?.ok === false) reasons.push('SCHEDULED_TASK_NOT_RUN');
  const captureState = timeBound && DAILY_ACCEPTANCE_STATES.includes(item.captureState) ? item.captureState : 'UNKNOWN';
  const persistenceState = observed && DAILY_ACCEPTANCE_STATES.includes(item.persistenceState) ? item.persistenceState : 'UNKNOWN';
  const integrityState = timeBound && DAILY_ACCEPTANCE_STATES.includes(item.integrityState) ? item.integrityState : 'UNKNOWN';
  const researchEligibility = timeBound && captureState === 'PASS' && persistenceState === 'PASS'
    && integrityState !== 'FAIL' && RESEARCH_ELIGIBILITY_STATES.includes(item.researchEligibility)
    ? item.researchEligibility : 'UNKNOWN';
  return closeFeed({ ...base, captureState, persistenceState, integrityState, researchEligibility,
    sourceStage: item?.sourceStage || definition.stageKey,
    stageEvidence: stage ? { key: stage.key, ok: stage.ok, completedAt: dailyStatus.completedAt } : null,
    sourceDate: sameDate ? item.sourceDate : null, availableAt: timeBound ? item.availableAt : null,
    observedAt: observed ? item.observedAt : null,
    recordCount: artifactKnown ? nullableNumber(item.recordCount) : null,
    bytes: artifactKnown ? nullableNumber(item.bytes) : null,
    reasonCodes: reasons, sourceArtifactIdentity: artifactKnown ? item.sourceArtifactIdentity : null,
    lineage: artifactKnown ? item.lineage || null : null,
    components: artifactKnown && item.components ? Object.fromEntries(Object.entries(item.components)
      .map(([key, value]) => [key, timeBound ? value : 'UNKNOWN'])) : null,
    evidenceStrength: observed ? 'DATASET_ARTIFACT' : stage ? 'DAILY_UPDATE_STAGE_ONLY' : 'NONE',
    smallestNextCheck: '核對此資料集的來源列身分與當時可用性；不以 stage 成功代替資料證據',
  });
}

function derivedFeed(context, evidence) {
  const definition = { datasetId: 'derived_pressure_response_efficiency', ownerLabelZh: '壓力、價格反應與路徑效率研究資格', technicalLabelEn: 'Pressure / Price Response / Path Efficiency', quoteType: 'Derived metrics', mode: 'DERIVED', material: false };
  const base = feedBase(definition, { ...context, session: evidence?.session || 'NIGHT_PLUS_DAY', expectedState: 'REQUIRED', expectedWindow: '來源資料持久化後' });
  base.source = 'Existing CRU-34 / CRU-44 projection artifact';
  if (context.marketDayState === 'NON_TRADING_DAY') return notExpectedFeed(definition, { ...context, session: base.session }, 'MARKET_CLOSED');
  const matched = evidence?.tradeDate === context.tradeDate && context.sessions.includes(evidence?.session)
    && typeof evidence.actualContract === 'string' && evidence.actualContract.length > 0;
  const known = matched && artifactIdentityPresent(evidence?.sourceArtifactIdentity);
  const bound = context.marketDayState === 'TRADING_DAY' && known && evidence.cutoffValidated === true
    && validTimeAtCutoff(evidence.generatedAt, context.generatedAt)
    && validTimeAtCutoff(evidence.availableAt, context.generatedAt);
  const codes = [...(evidence?.reasonCodes || [])];
  if (!bound) codes.push('PROJECTION_NOT_READY');
  if (evidence && evidence.tradeDate !== context.tradeDate) codes.push('TRADE_DATE_MISMATCH');
  if (evidence && !context.sessions.includes(evidence.session)) codes.push('SESSION_MISMATCH');
  const state = (key) => bound && DAILY_ACCEPTANCE_STATES.includes(evidence?.[key]) ? evidence[key] : 'UNKNOWN';
  return closeFeed({ ...base,
    expectedState: context.marketDayState === 'UNKNOWN' ? 'UNKNOWN' : base.expectedState,
    actualContract: known ? evidence.actualContract : null,
    captureState: state('captureState'), persistenceState: state('persistenceState'), integrityState: state('integrityState'),
    researchEligibility: bound && RESEARCH_ELIGIBILITY_STATES.includes(evidence.researchEligibility) ? evidence.researchEligibility : 'UNKNOWN',
    availableAt: bound ? evidence.availableAt : null, generatedAt: known ? evidence.generatedAt : null,
    recordCount: known ? nullableNumber(evidence.recordCount) : null, bytes: known ? nullableNumber(evidence.bytes) : null,
    sourceArtifactIdentity: known ? evidence.sourceArtifactIdentity : null,
    windows: bound ? evidence.windows || null : null,
    reasonCodes: codes, evidenceStrength: bound ? 'DERIVED_ARTIFACT' : 'NONE',
    smallestNextCheck: '核對指定日期與時段的 immutable 投影、來源 prefix 與可用截止時間',
  });
}

function sessionState(feeds, session) {
  const rows = feeds.filter((feed) => feed.session === session && feed.mode === 'LIVE_EVENT'
    && feed.expectedState === 'REQUIRED');
  if (!rows.length || rows.every((feed) => feed.captureState === 'NOT_EXPECTED')) return 'NOT_EXPECTED';
  if (rows.some((feed) => feed.captureState === 'FAIL' || feed.persistenceState === 'FAIL'
      || feed.integrityState === 'FAIL' || feed.coverageState === 'FAIL')) return 'FAIL';
  if (rows.some((feed) => ['UNKNOWN', 'PARTIAL'].includes(feed.captureState)
      || ['UNKNOWN', 'PARTIAL', 'PENDING'].includes(feed.persistenceState)
      || ['UNKNOWN', 'PARTIAL', 'PENDING'].includes(feed.integrityState)
      || ['UNKNOWN', 'PARTIAL', 'PENDING'].includes(feed.coverageState))) return 'UNKNOWN';
  return 'PASS';
}

export function buildDailyCollectionAcceptance({
  calendarDate,
  tradeDate,
  marketDayState,
  generatedAt,
  sessions = ['DAY', 'NIGHT'],
  registry,
  liveEvidence = null,
  dailyUpdateStatus = null,
  batchEvidence = {},
  derivedEvidence = null,
  storageEvidence = {},
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate || '')) throw new Error('DAILY_ACCEPTANCE_CALENDAR_DATE_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('DAILY_ACCEPTANCE_TRADE_DATE_INVALID');
  if (!Number.isFinite(Date.parse(generatedAt || ''))) throw new Error('DAILY_ACCEPTANCE_GENERATED_AT_INVALID');
  if (!['TRADING_DAY', 'NON_TRADING_DAY', 'UNKNOWN'].includes(marketDayState)) throw new Error('DAILY_ACCEPTANCE_MARKET_DAY_STATE_INVALID');
  const normalizedSessions = unique(sessions).filter((item) => ['DAY', 'NIGHT'].includes(item));
  const context = { calendarDate, tradeDate, marketDayState, generatedAt, sessions: normalizedSessions };
  const byDataset = registryMap(registry);
  const feeds = [];
  for (const definition of LIVE_FEEDS) {
    for (const session of ['DAY', 'NIGHT']) feeds.push(liveFeed(definition, session, context, liveEvidence, byDataset));
  }
  for (const definition of BATCH_FEEDS) feeds.push(batchFeed(
    definition, context, dailyUpdateStatus, batchEvidence?.[definition.datasetId] || null, byDataset,
  ));
  const derivedEntries = derivedEvidence?.entries;
  if (Array.isArray(derivedEntries) && derivedEntries.length) {
    for (const entry of derivedEntries) feeds.push(derivedFeed(context, entry));
  } else feeds.push(derivedFeed(context, derivedEvidence?.entries ? null : derivedEvidence));
  for (const definition of FUTURE_FEEDS) {
    feeds.push(notExpectedFeed({ ...definition, mode: 'FUTURE_SOURCE' }, { ...context, session: 'NOT_APPLICABLE', expectedWindow: '未授權' }, 'NOT_ENABLED'));
  }

  const due = feeds.filter((feed) => feed.expectedState === 'REQUIRED');
  const exactFailures = due.filter((feed) => feed.captureState === 'FAIL'
    || feed.persistenceState === 'FAIL' || feed.integrityState === 'FAIL'
    || (feed.mode === 'LIVE_EVENT' && feed.coverageState === 'FAIL'));
  const partialProblems = due.filter((feed) => feed.captureState === 'PARTIAL'
    || feed.persistenceState === 'PARTIAL' || feed.integrityState === 'PARTIAL'
    || (feed.mode === 'LIVE_EVENT' && feed.coverageState === 'PARTIAL'));
  const unknownDue = due.filter((feed) => ['UNKNOWN', 'PENDING'].includes(feed.captureState)
    || ['UNKNOWN', 'PENDING'].includes(feed.persistenceState)
    || ['UNKNOWN', 'PENDING'].includes(feed.integrityState)
    || (feed.mode === 'LIVE_EVENT' && ['UNKNOWN', 'PENDING'].includes(feed.coverageState)));
  let overallState = 'PASS';
  if (marketDayState === 'UNKNOWN') overallState = 'UNKNOWN';
  else if (marketDayState === 'NON_TRADING_DAY') overallState = 'NOT_EXPECTED';
  else if (exactFailures.length === due.length && due.length > 0) overallState = 'FAIL';
  else if (exactFailures.length || partialProblems.length) overallState = 'PARTIAL';
  else if (unknownDue.length) overallState = 'UNKNOWN';
  else if (!due.length) overallState = feeds.some((feed) => feed.expectedState === 'PENDING') ? 'PENDING' : 'NOT_EXPECTED';

  const timestamps = feeds.filter((feed) => feed.mode === 'LIVE_EVENT')
    .flatMap((feed) => [feed.firstReceivedAt, feed.lastReceivedAt]).filter(Boolean)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const rawBytes = nullableNumber(liveEvidence?.totalRawBytes);
  const rawRecords = nullableNumber(liveEvidence?.totalRecords);
  const derivedBytes = nullableNumber(storageEvidence.derivedArtifactBytes);
  const auditBytes = nullableNumber(storageEvidence.auditReportBytes);
  const knownBytes = [rawBytes, derivedBytes, auditBytes].filter((value) => value != null);
  const report = {
    schemaVersion: DAILY_COLLECTION_ACCEPTANCE_SCHEMA_VERSION,
    calendarDate,
    tradeDate,
    marketDayState,
    generatedAt: new Date(generatedAt).toISOString(),
    overallState,
    sessions: normalizedSessions,
    sourceArtifactIdentity: liveEvidence?.sourceArtifactIdentity || null,
    summary: {
      requiredCount: due.length,
      capturedCount: due.filter((feed) => feed.captureState === 'PASS').length,
      persistedCount: due.filter((feed) => feed.persistenceState === 'PASS').length,
      researchReadyCount: due.filter((feed) => ['READY', 'READY_WITH_LIMITATION'].includes(feed.researchEligibility)).length,
      totalRawBytes: rawBytes,
      totalRecords: rawRecords,
      firstLiveReceivedAt: timestamps[0] || null,
      lastLiveReceivedAt: timestamps.at(-1) || null,
      daySessionState: sessionState(feeds, 'DAY'),
      nightSessionState: sessionState(feeds, 'NIGHT'),
      reconnectCount: nullableNumber(liveEvidence?.reconnectCount),
      callbackErrors: nullableNumber(liveEvidence?.callbackErrors),
      writerErrors: nullableNumber(liveEvidence?.writerErrors),
      droppedEvents: nullableNumber(liveEvidence?.droppedEvents),
    },
    storage: {
      rawLedgerBytes: rawBytes,
      rawLedgerScope: rawBytes == null ? 'NOT_VERIFIED' : 'selected immutable ledger byte cutoffs only',
      derivedArtifactBytes: derivedBytes,
      derivedArtifactScope: derivedBytes == null ? 'NOT_VERIFIED' : 'selected derived artifact only',
      auditReportBytes: auditBytes,
      auditReportScope: auditBytes == null ? 'NOT_VERIFIED' : 'selected audit/status artifacts only',
      totalBytes: knownBytes.length === 3 ? knownBytes.reduce((sum, value) => sum + value, 0) : null,
      totalBytesScope: knownBytes.length === 3 ? 'sum of the three explicitly scoped evidence classes' : 'NOT_VERIFIED',
      forecast: 'NOT_VERIFIED',
    },
    feeds,
    safety: { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false },
  };
  return Object.freeze(report);
}

function familyOf(record) {
  const payload = record?.payload || {};
  return String(payload.productFamily || payload._product_family || record.product || record.code || '');
}

function feedKey(record, session) {
  const family = familyOf(record);
  if (record.kind === 'futures_tick' && ['TX', 'MTX', 'TMF'].includes(family)) return `${family}:futures_tick:${session}`;
  if (record.kind === 'futures_bidask' && ['TX', 'MTX', 'TMF'].includes(family)) return `${family}:futures_bidask:${session}`;
  if (record.kind === 'stock_tick' && (family === '2330' || record.code === '2330')) return `2330:stock_tick:${session}`;
  if (record.kind === 'index_quote' && (family === 'IX0001' || record.code === 'IX0001')) return `IX0001:index_quote:${session}`;
  return null;
}

function contractOf(record) {
  const payload = record?.payload || {};
  return String(payload.actualContract || payload.targetCode || payload._target_code || payload.code || record.code || record.product || '').trim() || null;
}

function eventTimeOf(record) {
  const payload = record?.payload || {};
  return payload.eventTime || payload.datetime || payload.timestamp || record.exchangeTimestamp || null;
}

function identityOf(record, calendar) {
  const payload = record?.payload || {};
  const explicitTradeDate = payload.tradeDate || payload._trade_date || record.tradeDate || null;
  const explicitSession = payload.session || payload._session || record.session || null;
  let classified;
  if (['stock_tick', 'index_quote'].includes(record.kind)) {
    const eventDate = payload.date || String(eventTimeOf(record) || '').slice(0, 10) || null;
    classified = /^\d{4}-\d{2}-\d{2}$/.test(eventDate || '')
      ? {
        calendarDate: eventDate, tradeDate: eventDate, session: 'DAY',
        sessionStart: new Date(`${eventDate}T09:00:00+08:00`).toISOString(),
        sessionEnd: new Date(`${eventDate}T13:30:00+08:00`).toISOString(),
      } : null;
  } else {
    try { classified = classifyTxChartSession(eventTimeOf(record), calendar); } catch { classified = null; }
  }
  if (!classified) return { tradeDate: null, session: null, valid: false };
  const matchesExplicit = (!explicitTradeDate || explicitTradeDate === classified.tradeDate)
    && (!explicitSession || explicitSession === classified.session);
  return { ...classified, valid: matchesExplicit };
}

function ensureFeedEvidence(feeds, key) {
  if (!key) return null;
  if (!feeds[key]) {
    feeds[key] = {
      recordCount: 0, bytes: 0, firstReceivedAt: null, lastReceivedAt: null, contracts: [],
      calendarDates: [], nativeSequenceAvailable: false, nativeSequenceMissing: false,
      nativeSequenceGapUnknown: false, nativeSequenceGaps: 0, invalidLines: 0,
      sessionStart: null, sessionEnd: null,
    };
  }
  return feeds[key];
}

function updateCounter(target, key, value) {
  if (Object.hasOwn(target, key) && Number.isFinite(Number(value))) target[key] = Math.max(target[key], Number(value));
}

function completeLineCutoff(filePath) {
  const size = fs.statSync(filePath).size;
  if (!size) return 0;
  const fd = fs.openSync(filePath, 'r');
  let end = size;
  try {
    while (end > 0) {
      const length = Math.min(end, 64 * 1024);
      const start = end - length;
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, start);
      const lastNewline = buffer.lastIndexOf(0x0a);
      if (lastNewline >= 0) return start + lastNewline + 1;
      end = start;
    }
    return 0;
  } finally { fs.closeSync(fd); }
}

function boundaryRecordHashes(filePath, cutoffBytes) {
  if (!cutoffBytes) return { firstRecordHash: null, lastRecordHash: null };
  const firstLength = Math.min(cutoffBytes, 64 * 1024);
  const tailLength = Math.min(cutoffBytes, 64 * 1024);
  const firstBuffer = Buffer.allocUnsafe(firstLength);
  const tailBuffer = Buffer.allocUnsafe(tailLength);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, firstBuffer, 0, firstLength, 0);
    fs.readSync(fd, tailBuffer, 0, tailLength, cutoffBytes - tailLength);
  } finally { fs.closeSync(fd); }
  const firstLine = firstBuffer.toString('utf8').split('\n')[0];
  const tailLines = tailBuffer.toString('utf8').split('\n').filter(Boolean);
  try {
    return {
      firstRecordHash: JSON.parse(firstLine).recordHash || null,
      lastRecordHash: JSON.parse(tailLines.at(-1)).recordHash || null,
    };
  } catch {
    return { firstRecordHash: null, lastRecordHash: null };
  }
}

function potentiallyRelevantLine(line) {
  const live = ((line.includes('"kind":"futures_tick"') || line.includes('"kind":"futures_bidask"'))
      && (/"_product_family":"(TX|MTX|TMF)"/.test(line) || /"productFamily":"(TX|MTX|TMF)"/.test(line)
        || /"product":"(TXF|MXF|TMF)[A-L]\d"/.test(line)))
    || (line.includes('"kind":"stock_tick"') && line.includes('"code":"2330"'))
    || (line.includes('"kind":"index_quote"') && line.includes('"code":"IX0001"'));
  const operations = line.includes('"kind":"session_down"')
    || (line.includes('"kind":"provider_event"') && /reconnect/i.test(line))
    || line.includes('"callbackErrors"') || line.includes('"writerErrors"')
    || line.includes('"dropped"') || line.includes('"droppedEvents"');
  return live || operations;
}

export async function streamDailyLedgerEvidence(filePaths, {
  calendar, tradeDate, generatedAt = null, ledgerAudit = null, cutoffBytesByFile = {},
  expectedSessionsByFile = {}, sessionWindows = {},
} = {}) {
  if (!calendar) throw new Error('DAILY_ACCEPTANCE_CALENDAR_REQUIRED');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('DAILY_ACCEPTANCE_TRADE_DATE_INVALID');
  const generatedMs = generatedAt == null ? null : Date.parse(generatedAt);
  if (generatedAt != null && !Number.isFinite(generatedMs)) throw new Error('DAILY_ACCEPTANCE_GENERATED_AT_INVALID');
  const feeds = {};
  const identities = [];
  let totalRawBytes = 0;
  let totalRecords = 0;
  let invalidLines = 0;
  let nativeSequenceAvailable = false;
  let reconnectCount = 0;
  const counters = { callbackErrors: 0, writerErrors: 0, droppedEvents: 0 };
  const sessions = {
    DAY: { reconnectCount: 0, callbackErrors: 0, writerErrors: 0, droppedEvents: 0 },
    NIGHT: { reconnectCount: 0, callbackErrors: 0, writerErrors: 0, droppedEvents: 0 },
  };
  const candidates = [...new Set(filePaths.map((item) => path.resolve(item)))].sort();
  const unavailableFiles = [];
  const unavailableArtifacts = [];
  const missingFilesBySession = { DAY: [], NIGHT: [] };
  for (const candidate of candidates) {
    const file = path.basename(candidate);
    const expectedSessions = expectedSessionsByFile[file]
      || (path.basename(file, '.ndjson') === tradeDate ? ['DAY', 'NIGHT'] : ['NIGHT']);
    if (!fs.existsSync(candidate)) {
      unavailableFiles.push(file);
      unavailableArtifacts.push({ file, exists: false, availableBytes: null, cutoffBytes: null });
      for (const session of expectedSessions) missingFilesBySession[session]?.push(file);
      continue;
    }
    const completeBytes = completeLineCutoff(candidate);
    const requestedCutoff = cutoffBytesByFile[file];
    const cutoffBytes = requestedCutoff == null ? completeBytes : Number(requestedCutoff);
    if (!Number.isInteger(cutoffBytes) || cutoffBytes < 0 || cutoffBytes > completeBytes) {
      throw new Error(`DAILY_ACCEPTANCE_LEDGER_CUTOFF_INVALID:${path.basename(candidate)}`);
    }
    if (cutoffBytes > 0) {
      const byte = Buffer.allocUnsafe(1);
      const fd = fs.openSync(candidate, 'r');
      try { fs.readSync(fd, byte, 0, 1, cutoffBytes - 1); } finally { fs.closeSync(fd); }
      if (byte[0] !== 0x0a) throw new Error(`DAILY_ACCEPTANCE_LEDGER_CUTOFF_NOT_LINE_BOUNDARY:${path.basename(candidate)}`);
    }
    if (!cutoffBytes) {
      unavailableFiles.push(file);
      unavailableArtifacts.push({ file, exists: true, availableBytes: fs.statSync(candidate).size, cutoffBytes: 0 });
      for (const session of expectedSessions) missingFilesBySession[session]?.push(file);
      continue;
    }
    totalRawBytes += cutoffBytes;
    let physicalRecords = 0;
    const identity = {
      file: path.basename(candidate), cutoffBytes,
      ...boundaryRecordHashes(candidate, cutoffBytes),
    };
    const input = fs.createReadStream(candidate, {
      start: 0, end: cutoffBytes - 1, highWaterMark: 8 * 1024 * 1024,
    });
    const prefixHash = crypto.createHash('sha256');
    const hashTap = new Transform({
      transform(chunk, encoding, callback) {
        prefixHash.update(chunk);
        callback(null, chunk);
      },
    });
    input.pipe(hashTap);
    hashTap.setEncoding('utf8');
    const lines = readline.createInterface({ input: hashTap, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      physicalRecords += 1;
      if (!potentiallyRelevantLine(line)) continue;
      let record;
      try { record = JSON.parse(line); } catch { invalidLines += 1; continue; }
      const identityContext = identityOf(record, calendar);
      const candidateKey = feedKey(record, identityContext.session);
      if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) {
        const item = ensureFeedEvidence(feeds, candidateKey);
        if (item) item.invalidLines += 1;
        invalidLines += 1;
        continue;
      }
      const receivedMs = Date.parse(record.receivedAt || '');
      if (!Number.isFinite(receivedMs)) {
        const item = ensureFeedEvidence(feeds, candidateKey);
        if (item) item.invalidLines += 1;
        invalidLines += 1;
        continue;
      }
      if (generatedMs != null && receivedMs > generatedMs) continue;
      const payload = record.payload || {};
      if (!identityContext.valid) {
        const item = ensureFeedEvidence(feeds, candidateKey);
        if (item) item.invalidLines += 1;
        invalidLines += 1;
        continue;
      }
      if (identityContext.tradeDate !== tradeDate || !['DAY', 'NIGHT'].includes(identityContext.session)) continue;
      updateCounter(counters, 'callbackErrors', payload.callbackErrors);
      updateCounter(counters, 'writerErrors', payload.writerErrors);
      updateCounter(counters, 'droppedEvents', payload.dropped ?? payload.droppedEvents);
      if (record.kind === 'session_down' || (record.kind === 'provider_event' && /reconnect/i.test(payload.event || ''))) reconnectCount += 1;
      const sessionCounters = sessions[identityContext.session];
      updateCounter(sessionCounters, 'callbackErrors', payload.callbackErrors);
      updateCounter(sessionCounters, 'writerErrors', payload.writerErrors);
      updateCounter(sessionCounters, 'droppedEvents', payload.dropped ?? payload.droppedEvents);
      if (record.kind === 'session_down' || (record.kind === 'provider_event' && /reconnect/i.test(payload.event || ''))) sessionCounters.reconnectCount += 1;
      const key = feedKey(record, identityContext.session);
      if (!key || record.duplicate === true || payload.simtrade === true) continue;
      totalRecords += 1;
      const validSequence = typeof record.sequence === 'number'
        && Number.isSafeInteger(record.sequence) && record.sequence >= 0;
      if (validSequence) nativeSequenceAvailable = true;
      const item = ensureFeedEvidence(feeds, key);
      if (!validSequence) item.nativeSequenceMissing = true;
      else {
        item.nativeSequenceAvailable = true;
        const validGap = typeof record.sequenceGap === 'number'
          && Number.isSafeInteger(record.sequenceGap) && record.sequenceGap >= 0;
        if (!validGap) item.nativeSequenceGapUnknown = true;
        else item.nativeSequenceGaps += record.sequenceGap;
      }
      item.recordCount += 1;
      item.bytes += Buffer.byteLength(line, 'utf8') + 1;
      item.calendarDates = unique([...item.calendarDates, identityContext.calendarDate]).sort();
      item.sessionStart = item.sessionStart || identityContext.sessionStart || null;
      item.sessionEnd = item.sessionEnd || identityContext.sessionEnd || null;
      if (!item.firstReceivedAt || Date.parse(record.receivedAt) < Date.parse(item.firstReceivedAt)) item.firstReceivedAt = record.receivedAt || null;
      if (!item.lastReceivedAt || Date.parse(record.receivedAt) > Date.parse(item.lastReceivedAt)) item.lastReceivedAt = record.receivedAt || null;
      item.contracts = unique([...item.contracts, contractOf(record)]).sort();
      feeds[key] = item;
    }
    identity.prefixSha256 = prefixHash.digest('hex');
    identity.physicalRecords = physicalRecords;
    identities.push(identity);
  }
  const auditSources = ledgerAudit?.sources || [];
  const auditComplete = identities.length > 0 && unavailableFiles.length === 0
    && identities.every((identity) => auditSources.some((audit) => (
    audit.sourceFile === identity.file && audit.bytes === identity.cutoffBytes
      && audit.latestHash === identity.lastRecordHash && audit.ok === true && audit.sequenceGaps === 0
      && audit.prefixSha256 === identity.prefixSha256
  )));
  const auditFailed = identities.some((identity) => auditSources.some((audit) => (
    audit.sourceFile === identity.file && audit.bytes === identity.cutoffBytes
      && audit.latestHash === identity.lastRecordHash && audit.ok === false
  )));
  const boundedLedgerAudit = auditComplete ? { ok: true, sources: auditSources }
    : auditFailed ? { ok: false, sources: auditSources } : null;
  const auditForSession = (session) => {
    const relevant = identities.filter((identity) => (expectedSessionsByFile[identity.file]
      || (identity.file === `${tradeDate}.ndjson` ? ['DAY', 'NIGHT'] : ['NIGHT'])).includes(session));
    const sources = auditSources.filter((audit) => relevant.some((identity) => identity.file === audit.sourceFile));
    const exact = (identity, audit) => audit.sourceFile === identity.file && audit.bytes === identity.cutoffBytes
      && audit.latestHash === identity.lastRecordHash && audit.prefixSha256 === identity.prefixSha256;
    if (relevant.some((identity) => sources.some((audit) => exact(identity, audit) && audit.ok === false))) return { ok: false, sources };
    if (relevant.length && !missingFilesBySession[session].length
      && relevant.every((identity) => sources.some((audit) => exact(identity, audit) && audit.ok === true && audit.sequenceGaps === 0))) return { ok: true, sources };
    return null;
  };
  return Object.freeze({
    ledgerFound: identities.length > 0,
    missingFiles: unavailableFiles,
    sessions: {
      DAY: { ...sessions.DAY, missingFiles: missingFilesBySession.DAY, ledgerAudit: auditForSession('DAY') },
      NIGHT: { ...sessions.NIGHT, missingFiles: missingFilesBySession.NIGHT, ledgerAudit: auditForSession('NIGHT') },
    },
    feeds,
    totalRawBytes: identities.length ? totalRawBytes : null,
    totalRecords: identities.length ? totalRecords : null,
    reconnectCount: identities.length ? reconnectCount : null,
    callbackErrors: identities.length ? counters.callbackErrors : null,
    writerErrors: identities.length ? counters.writerErrors : null,
    droppedEvents: identities.length ? counters.droppedEvents : null,
    invalidLines,
    nativeSequenceAvailable,
    ledgerAudit: boundedLedgerAudit,
    sessionWindows: Object.freeze({ ...sessionWindows }),
    sourceArtifactIdentity: candidates.length ? {
      type: 'append-only-ledger-fixed-byte-cutoff', files: identities,
      unavailableFiles: unavailableArtifacts, missingFiles: unavailableFiles,
    } : null,
  });
}

export function stableDailyAcceptanceJson(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}
