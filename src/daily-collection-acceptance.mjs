import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
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
});

const LIVE_FEEDS = Object.freeze([
  Object.freeze({ datasetId: 'tx_actual_trade', ownerLabelZh: '臺指期逐筆成交', technicalLabelEn: 'TX Tick', quoteType: 'Tick', family: 'TX', kind: 'futures_tick', sessions: ['DAY', 'NIGHT'], material: true }),
  Object.freeze({ datasetId: 'tx_best_quote', ownerLabelZh: '臺指期最佳買賣報價', technicalLabelEn: 'TX BidAsk', quoteType: 'BidAsk', family: 'TX', kind: 'futures_bidask', sessions: ['DAY', 'NIGHT'], material: true }),
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
    persistenceState: 'NOT_EXPECTED',
    integrityState: 'NOT_EXPECTED',
    researchEligibility: 'NOT_APPLICABLE',
    reasonCodes: [reasonCode],
    evidenceStrength: 'GOVERNED_SCOPE',
    smallestNextCheck: '不需修復；僅在另案授權後重新評估',
  });
}

function liveFeed(definition, session, context, evidence, registry) {
  if (context.marketDayState !== 'TRADING_DAY') {
    return notExpectedFeed(definition, { ...context, session, expectedWindow: session }, 'MARKET_CLOSED');
  }
  if (!definition.sessions.includes(session)) {
    return notExpectedFeed(definition, { ...context, session, expectedWindow: session }, 'NOT_IN_CURRENT_SCOPE');
  }
  if (!context.sessions.includes(session)) {
    return notExpectedFeed(definition, { ...context, session, expectedWindow: session }, 'NOT_IN_CURRENT_SCOPE');
  }
  const key = `${definition.family}:${definition.kind}:${session}`;
  const item = evidence?.feeds?.[key] || null;
  const base = feedBase(definition, { ...context, session, expectedState: 'REQUIRED', expectedWindow: session });
  const registryItem = registry.get(definition.datasetId);
  if (!evidence?.ledgerFound) {
    return closeFeed({ ...base, reasonCodes: ['LEDGER_NOT_FOUND'], downstreamImpact: [definition.datasetId], smallestNextCheck: '確認指定 calendarDate 的唯讀 ledger 路徑' });
  }
  if (!item || item.recordCount === 0) {
    return closeFeed({
      ...base, recordCount: 0, bytes: 0, captureState: 'FAIL', persistenceState: 'UNKNOWN',
      reasonCodes: ['CAPTURE_GAP_UNEXPLAINED'], evidenceStrength: 'BOUNDED_LEDGER_SCAN',
      sourceArtifactIdentity: evidence.sourceArtifactIdentity, downstreamImpact: [definition.datasetId],
      smallestNextCheck: `核對 ${definition.technicalLabelEn} 訂閱與 writer delivery evidence`,
    });
  }
  const reasons = [];
  if (item.contracts.length !== 1) reasons.push('ACTUAL_CONTRACT_MISMATCH');
  if (item.nativeSequenceAvailable !== true || item.nativeSequenceMissing === true) reasons.push('NATIVE_SEQUENCE_UNAVAILABLE');
  if (evidence.callbackErrors > 0) reasons.push('CALLBACK_ERROR');
  if (evidence.writerErrors > 0) reasons.push('WRITER_ERROR');
  if (evidence.droppedEvents > 0) reasons.push('QUEUE_DROP');
  if (evidence.reconnectCount > 0) reasons.push('PROVIDER_RECONNECT');
  if (evidence.invalidLines > 0) reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  const persistenceState = evidence.writerErrors > 0 || evidence.droppedEvents > 0 ? 'FAIL' : 'PASS';
  const knownIntegrityFailure = evidence.ledgerAudit?.ok === false;
  const integrityState = knownIntegrityFailure ? 'FAIL'
    : evidence.ledgerAudit?.ok === true && item.nativeSequenceAvailable === true
      && item.nativeSequenceMissing !== true ? 'PASS' : 'UNKNOWN';
  const captureState = item.contracts.length === 1 ? 'PASS' : 'PARTIAL';
  const researchEligibility = captureState === 'PASS' && persistenceState === 'PASS'
    ? (integrityState === 'PASS' && registryItem?.quality_status === 'PASS' ? 'READY' : 'READY_WITH_LIMITATION')
    : 'NOT_READY';
  return closeFeed({
    ...base,
    actualContract: item.contracts.length === 1 ? item.contracts[0] : null,
    firstReceivedAt: item.firstReceivedAt,
    lastReceivedAt: item.lastReceivedAt,
    recordCount: item.recordCount,
    bytes: item.bytes,
    captureState,
    persistenceState,
    integrityState,
    researchEligibility,
    reasonCodes: reasons,
    evidenceStrength: evidence.ledgerAudit ? 'LEDGER_AUDIT_PLUS_BOUNDED_SCAN' : 'BOUNDED_LEDGER_SCAN',
    sourceArtifactIdentity: evidence.sourceArtifactIdentity,
    downstreamImpact: researchEligibility === 'NOT_READY' ? [definition.datasetId, 'derived_pressure_response_efficiency'] : [],
    smallestNextCheck: reasons.includes('NATIVE_SEQUENCE_UNAVAILABLE')
      ? '保留完整性 UNKNOWN；如需更強結論，另找獨立成交量或序列證據'
      : '核對當日 governed audit 與來源時間窗',
  });
}

function publicationTime(tradeDate) {
  return Date.parse(`${tradeDate}T15:30:00+08:00`);
}

function batchFeed(definition, context, dailyStatus, datasetEvidence, registry) {
  const base = feedBase(definition, { ...context, session: 'EOD', expectedState: 'REQUIRED', expectedWindow: '盤後官方發布後' });
  if (context.marketDayState !== 'TRADING_DAY') return notExpectedFeed(definition, { ...context, session: 'EOD', expectedWindow: '盤後官方發布後' }, 'MARKET_CLOSED');
  const completedMs = Date.parse(dailyStatus?.completedAt || '');
  const generatedMs = Date.parse(context.generatedAt);
  const statusAvailableAtCutoff = Number.isFinite(completedMs) && completedMs <= generatedMs;
  const stage = statusAvailableAtCutoff
    ? (dailyStatus?.stages || []).find((item) => item.key === definition.stageKey) || null
    : null;
  const reportBeforePublication = Number.isFinite(completedMs) && completedMs < publicationTime(context.tradeDate);
  if (!stage && generatedMs < publicationTime(context.tradeDate)) {
    return closeFeed({ ...base, expectedState: 'PENDING', captureState: 'PENDING', persistenceState: 'PENDING', integrityState: 'PENDING', researchEligibility: 'UNKNOWN', reasonCodes: ['NOT_PUBLISHED_YET'], evidenceStrength: 'GOVERNED_PUBLICATION_WINDOW', smallestNextCheck: '官方發布時窗後重跑每日驗收' });
  }
  if (reportBeforePublication && statusAvailableAtCutoff) {
    return closeFeed({ ...base, expectedState: 'PENDING', captureState: 'PENDING', persistenceState: 'PENDING', integrityState: 'PENDING', researchEligibility: 'UNKNOWN', reasonCodes: ['NOT_PUBLISHED_YET'], evidenceStrength: 'DAILY_UPDATE_STAGE', sourceArtifactIdentity: dailyStatus?.sourceArtifactIdentity || null, smallestNextCheck: '以官方發布後的新 Daily Update evidence 重跑' });
  }
  if (!stage) {
    return closeFeed({
      ...base,
      reasonCodes: [dailyStatus && !statusAvailableAtCutoff ? 'TIMESTAMP_LINEAGE_INSUFFICIENT'
        : dailyStatus ? 'SCHEDULED_TASK_NOT_RUN' : 'ARTIFACT_NOT_WRITTEN'],
      sourceArtifactIdentity: statusAvailableAtCutoff ? dailyStatus?.sourceArtifactIdentity || null : null,
      smallestNextCheck: dailyStatus && !statusAvailableAtCutoff
        ? '取得 generatedAt 當下或之前已完成的 Daily Update immutable evidence'
        : `核對 ${definition.stageKey} stage 的執行紀錄`,
    });
  }
  const registryItem = registry.get(definition.datasetId);
  if (!datasetEvidence) {
    return closeFeed({
      ...base,
      reasonCodes: [stage.ok === true ? 'TIMESTAMP_LINEAGE_INSUFFICIENT' : 'SCHEDULED_TASK_NOT_RUN'],
      evidenceStrength: 'DAILY_UPDATE_STAGE_ONLY',
      sourceArtifactIdentity: dailyStatus?.sourceArtifactIdentity || null,
      downstreamImpact: [definition.datasetId],
      smallestNextCheck: stage.ok === true
        ? '核對該 Dataset 的 official source date、row count 與 persisted artifact'
        : `檢查 ${definition.stageKey} stage log 後再核對 Dataset artifact`,
    });
  }
  const captureState = DAILY_ACCEPTANCE_STATES.includes(datasetEvidence.captureState)
    ? datasetEvidence.captureState : 'UNKNOWN';
  const persistenceState = DAILY_ACCEPTANCE_STATES.includes(datasetEvidence.persistenceState)
    ? datasetEvidence.persistenceState : 'UNKNOWN';
  const integrityState = DAILY_ACCEPTANCE_STATES.includes(datasetEvidence.integrityState)
    ? datasetEvidence.integrityState : 'UNKNOWN';
  const failed = captureState === 'FAIL' || persistenceState === 'FAIL' || integrityState === 'FAIL';
  const eligible = datasetEvidence.researchEligibility || (failed ? 'NOT_READY'
    : captureState === 'PASS' && persistenceState === 'PASS'
      ? (registryItem?.quality_status === 'PASS' ? 'READY' : 'READY_WITH_LIMITATION') : 'UNKNOWN');
  return closeFeed({
    ...base,
    firstReceivedAt: datasetEvidence.firstReceivedAt || null,
    lastReceivedAt: datasetEvidence.lastReceivedAt || null,
    recordCount: nullableNumber(datasetEvidence.recordCount),
    bytes: nullableNumber(datasetEvidence.bytes),
    captureState,
    persistenceState,
    integrityState,
    researchEligibility: RESEARCH_ELIGIBILITY_STATES.includes(eligible) ? eligible : 'UNKNOWN',
    reasonCodes: datasetEvidence.reasonCodes || [],
    evidenceStrength: datasetEvidence.evidenceStrength || 'DATASET_ARTIFACT',
    sourceArtifactIdentity: datasetEvidence.sourceArtifactIdentity || dailyStatus?.sourceArtifactIdentity || null,
    downstreamImpact: failed ? [definition.datasetId] : [],
    smallestNextCheck: datasetEvidence.smallestNextCheck || '核對 official source date / row-level availableAt',
  });
}

function derivedFeed(context, evidence, registry) {
  const definition = { datasetId: 'derived_pressure_response_efficiency', ownerLabelZh: '壓力、價格反應與路徑效率研究資格', technicalLabelEn: 'Pressure / Price Response / Path Efficiency', quoteType: 'Derived metrics', mode: 'DERIVED', material: false };
  const base = feedBase(definition, { ...context, session: evidence?.session || 'NIGHT_PLUS_DAY', expectedState: 'REQUIRED', expectedWindow: '來源資料持久化後' });
  base.source = 'Existing CRU-34 / CRU-44 projection artifact';
  if (!evidence) return closeFeed({ ...base, reasonCodes: ['PROJECTION_NOT_READY'], downstreamImpact: [definition.datasetId], smallestNextCheck: '讀取同 tradeDate/session 的既有投影 status 或 snapshot' });
  const reasonCodes = unique(evidence.reasonCodes || []);
  const eligibility = RESEARCH_ELIGIBILITY_STATES.includes(evidence.researchEligibility)
    ? evidence.researchEligibility : 'UNKNOWN';
  const registryItem = registry.get(definition.datasetId);
  return closeFeed({
    ...base,
    actualContract: evidence.actualContract || null,
    firstReceivedAt: evidence.firstReceivedAt || null,
    lastReceivedAt: evidence.lastReceivedAt || null,
    recordCount: nullableNumber(evidence.recordCount),
    bytes: nullableNumber(evidence.bytes),
    captureState: evidence.captureState || 'PASS',
    persistenceState: evidence.persistenceState || 'PASS',
    integrityState: evidence.integrityState || 'UNKNOWN',
    researchEligibility: eligibility,
    reasonCodes,
    evidenceStrength: evidence.evidenceStrength || 'DERIVED_ARTIFACT',
    sourceArtifactIdentity: evidence.sourceArtifactIdentity || null,
    downstreamImpact: eligibility === 'NOT_READY' ? [definition.datasetId] : [],
    smallestNextCheck: evidence.smallestNextCheck || (registryItem ? '核對 projection quality reason 與 raw feed identity' : '核對 canonical registry'),
  });
}

function sessionState(feeds, session) {
  const rows = feeds.filter((feed) => feed.session === session && feed.mode === 'LIVE_EVENT');
  if (!rows.length || rows.every((feed) => feed.captureState === 'NOT_EXPECTED')) return 'NOT_EXPECTED';
  if (rows.some((feed) => feed.captureState === 'FAIL')) return 'FAIL';
  if (rows.some((feed) => ['UNKNOWN', 'PARTIAL'].includes(feed.captureState))) return 'UNKNOWN';
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
  feeds.push(derivedFeed(context, derivedEvidence, byDataset));
  for (const definition of FUTURE_FEEDS) {
    feeds.push(notExpectedFeed({ ...definition, mode: 'FUTURE_SOURCE' }, { ...context, session: 'NOT_APPLICABLE', expectedWindow: '未授權' }, 'NOT_ENABLED'));
  }

  const due = feeds.filter((feed) => feed.expectedState === 'REQUIRED');
  const provenFailures = due.filter((feed) => feed.captureState === 'FAIL' || feed.persistenceState === 'FAIL' || feed.integrityState === 'FAIL');
  const unknownDue = due.filter((feed) => feed.captureState === 'UNKNOWN' || feed.persistenceState === 'UNKNOWN');
  let overallState = 'PASS';
  if (marketDayState === 'UNKNOWN') overallState = 'UNKNOWN';
  else if (marketDayState === 'NON_TRADING_DAY') overallState = 'NOT_EXPECTED';
  else if (provenFailures.length) overallState = provenFailures.length === due.length ? 'FAIL' : 'PARTIAL';
  else if (unknownDue.length) overallState = 'UNKNOWN';
  else if (!due.length) overallState = feeds.some((feed) => feed.expectedState === 'PENDING') ? 'PENDING' : 'NOT_EXPECTED';

  const timestamps = feeds.filter((feed) => feed.mode === 'LIVE_EVENT')
    .flatMap((feed) => [feed.firstReceivedAt, feed.lastReceivedAt]).filter(Boolean).sort();
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
  if (record.kind === 'futures_tick' && family === 'TX') return `TX:futures_tick:${session}`;
  if (record.kind === 'futures_bidask' && family === 'TX') return `TX:futures_bidask:${session}`;
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
  if (explicitTradeDate && explicitSession) return { tradeDate: explicitTradeDate, session: explicitSession };
  if (['stock_tick', 'index_quote'].includes(record.kind)) {
    return { tradeDate: payload.date || String(eventTimeOf(record) || '').slice(0, 10) || null, session: 'DAY' };
  }
  try {
    const classified = classifyTxChartSession(eventTimeOf(record), calendar);
    return { tradeDate: classified.tradeDate, session: classified.session };
  } catch {
    return { tradeDate: explicitTradeDate, session: explicitSession };
  }
}

function updateCounter(target, key, value) {
  if (Object.hasOwn(target, key) && Number.isFinite(Number(value))) target[key] = Math.max(target[key], Number(value));
}

function completeLineCutoff(filePath) {
  const size = fs.statSync(filePath).size;
  if (!size) return 0;
  const length = Math.min(size, 64 * 1024);
  const buffer = Buffer.allocUnsafe(length);
  const fd = fs.openSync(filePath, 'r');
  try { fs.readSync(fd, buffer, 0, length, size - length); } finally { fs.closeSync(fd); }
  const lastNewline = buffer.lastIndexOf(0x0a);
  return lastNewline < 0 ? 0 : size - length + lastNewline + 1;
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
      && (line.includes('"_product_family":"TX"') || line.includes('"productFamily":"TX"')
        || /"product":"TXF[A-L]\d"/.test(line)))
    || (line.includes('"kind":"stock_tick"') && line.includes('"code":"2330"'))
    || (line.includes('"kind":"index_quote"') && line.includes('"code":"IX0001"'));
  const operations = line.includes('"kind":"session_down"')
    || (line.includes('"kind":"provider_event"') && /reconnect/i.test(line))
    || line.includes('"callbackErrors"') || line.includes('"writerErrors"')
    || line.includes('"dropped"') || line.includes('"droppedEvents"');
  return live || operations;
}

export async function streamDailyLedgerEvidence(filePaths, {
  calendar, tradeDate, ledgerAudit = null, cutoffBytesByFile = {},
} = {}) {
  if (!calendar) throw new Error('DAILY_ACCEPTANCE_CALENDAR_REQUIRED');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('DAILY_ACCEPTANCE_TRADE_DATE_INVALID');
  const feeds = {};
  const identities = [];
  let totalRawBytes = 0;
  let totalRecords = 0;
  let invalidLines = 0;
  let nativeSequenceAvailable = false;
  let reconnectCount = 0;
  const counters = { callbackErrors: 0, writerErrors: 0, droppedEvents: 0 };
  for (const candidate of [...new Set(filePaths.map((item) => path.resolve(item)))].sort()) {
    if (!fs.existsSync(candidate)) continue;
    const completeBytes = completeLineCutoff(candidate);
    const requestedCutoff = cutoffBytesByFile[path.basename(candidate)];
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
    if (!cutoffBytes) continue;
    totalRawBytes += cutoffBytes;
    const identity = { file: path.basename(candidate), cutoffBytes, ...boundaryRecordHashes(candidate, cutoffBytes) };
    const input = fs.createReadStream(candidate, {
      encoding: 'utf8', start: 0, end: cutoffBytes - 1, highWaterMark: 8 * 1024 * 1024,
    });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      if (!potentiallyRelevantLine(line)) continue;
      let record;
      try { record = JSON.parse(line); } catch { invalidLines += 1; continue; }
      if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) {
        invalidLines += 1;
        continue;
      }
      const payload = record.payload || {};
      updateCounter(counters, 'callbackErrors', payload.callbackErrors);
      updateCounter(counters, 'writerErrors', payload.writerErrors);
      updateCounter(counters, 'droppedEvents', payload.dropped ?? payload.droppedEvents);
      if (record.kind === 'session_down' || (record.kind === 'provider_event' && /reconnect/i.test(payload.event || ''))) reconnectCount += 1;
      const identityContext = identityOf(record, calendar);
      if (identityContext.tradeDate !== tradeDate || !['DAY', 'NIGHT'].includes(identityContext.session)) continue;
      const key = feedKey(record, identityContext.session);
      if (!key || record.duplicate === true || payload.simtrade === true) continue;
      totalRecords += 1;
      if (record.sequence != null) nativeSequenceAvailable = true;
      const item = feeds[key] || {
        recordCount: 0, bytes: 0, firstReceivedAt: null, lastReceivedAt: null, contracts: [],
        nativeSequenceAvailable: false, nativeSequenceMissing: false,
      };
      if (record.sequence == null) item.nativeSequenceMissing = true;
      else item.nativeSequenceAvailable = true;
      item.recordCount += 1;
      item.bytes += Buffer.byteLength(line, 'utf8') + 1;
      if (!item.firstReceivedAt || Date.parse(record.receivedAt) < Date.parse(item.firstReceivedAt)) item.firstReceivedAt = record.receivedAt || null;
      if (!item.lastReceivedAt || Date.parse(record.receivedAt) > Date.parse(item.lastReceivedAt)) item.lastReceivedAt = record.receivedAt || null;
      item.contracts = unique([...item.contracts, contractOf(record)]).sort();
      feeds[key] = item;
    }
    identities.push(identity);
  }
  return Object.freeze({
    ledgerFound: identities.length > 0,
    feeds,
    totalRawBytes: identities.length ? totalRawBytes : null,
    totalRecords: identities.length ? totalRecords : null,
    reconnectCount: identities.length ? reconnectCount : null,
    callbackErrors: identities.length ? counters.callbackErrors : null,
    writerErrors: identities.length ? counters.writerErrors : null,
    droppedEvents: identities.length ? counters.droppedEvents : null,
    invalidLines,
    nativeSequenceAvailable,
    ledgerAudit,
    sourceArtifactIdentity: identities.length ? { type: 'append-only-ledger-fixed-byte-cutoff', files: identities } : null,
  });
}

const DATASET_TO_LIVE_KEY = Object.freeze({
  tx_actual_trade: ['TX', 'futures_tick'],
  tx_best_quote: ['TX', 'futures_bidask'],
  equity_2330_raw_price: ['2330', 'stock_tick'],
  taiex_index: ['IX0001', 'index_quote'],
});

export function reuseDailyLedgerEvidence(report, filePaths, { tradeDate } = {}) {
  if (report?.schemaVersion !== DAILY_COLLECTION_ACCEPTANCE_SCHEMA_VERSION || report?.tradeDate !== tradeDate) {
    throw new Error('DAILY_ACCEPTANCE_REUSE_REPORT_IDENTITY_INVALID');
  }
  if (report?.safety?.executionAuthorized !== false || report?.safety?.orderRoutesEnabled !== false) {
    throw new Error('DAILY_ACCEPTANCE_REUSE_REPORT_SAFETY_INVALID');
  }
  const liveRows = (report.feeds || []).filter((feed) => feed.mode === 'LIVE_EVENT');
  const sourceArtifactIdentity = liveRows.find((feed) => feed.sourceArtifactIdentity)?.sourceArtifactIdentity || null;
  if (sourceArtifactIdentity?.type !== 'append-only-ledger-fixed-byte-cutoff'
      || !Array.isArray(sourceArtifactIdentity.files)) {
    throw new Error('DAILY_ACCEPTANCE_REUSE_SOURCE_IDENTITY_MISSING');
  }
  const byName = new Map(filePaths.map((filePath) => [path.basename(filePath), path.resolve(filePath)]));
  for (const identity of sourceArtifactIdentity.files) {
    const candidate = byName.get(identity.file);
    const cutoffBytes = Number(identity.cutoffBytes);
    if (!candidate || !fs.existsSync(candidate) || !Number.isInteger(cutoffBytes)
        || cutoffBytes < 1 || cutoffBytes > completeLineCutoff(candidate)) {
      throw new Error(`DAILY_ACCEPTANCE_REUSE_LEDGER_INVALID:${identity.file}`);
    }
    const boundary = boundaryRecordHashes(candidate, cutoffBytes);
    if (boundary.firstRecordHash !== identity.firstRecordHash || boundary.lastRecordHash !== identity.lastRecordHash) {
      throw new Error(`DAILY_ACCEPTANCE_REUSE_LEDGER_HASH_MISMATCH:${identity.file}`);
    }
  }
  const feeds = {};
  for (const row of liveRows) {
    const mapping = DATASET_TO_LIVE_KEY[row.datasetId];
    if (!mapping || !['DAY', 'NIGHT'].includes(row.session) || row.recordCount == null) continue;
    const [family, kind] = mapping;
    feeds[`${family}:${kind}:${row.session}`] = {
      recordCount: row.recordCount,
      bytes: row.bytes,
      firstReceivedAt: row.firstReceivedAt,
      lastReceivedAt: row.lastReceivedAt,
      contracts: row.actualContract ? [row.actualContract] : [],
      nativeSequenceAvailable: !row.reasonCodes.includes('NATIVE_SEQUENCE_UNAVAILABLE'),
      nativeSequenceMissing: row.reasonCodes.includes('NATIVE_SEQUENCE_UNAVAILABLE'),
    };
  }
  return Object.freeze({
    ledgerFound: true,
    feeds,
    totalRawBytes: report.summary?.totalRawBytes ?? null,
    totalRecords: report.summary?.totalRecords ?? null,
    reconnectCount: report.summary?.reconnectCount ?? null,
    callbackErrors: report.summary?.callbackErrors ?? null,
    writerErrors: report.summary?.writerErrors ?? null,
    droppedEvents: report.summary?.droppedEvents ?? null,
    invalidLines: liveRows.some((row) => row.reasonCodes.includes('TIMESTAMP_LINEAGE_INSUFFICIENT')) ? 1 : 0,
    nativeSequenceAvailable: liveRows.length > 0
      && liveRows.every((row) => !row.reasonCodes.includes('NATIVE_SEQUENCE_UNAVAILABLE')),
    ledgerAudit: null,
    sourceArtifactIdentity,
    reusedFromAcceptance: true,
  });
}

export function stableDailyAcceptanceJson(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}
