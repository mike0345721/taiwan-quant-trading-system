const REASON_SUMMARIES = Object.freeze({
  NO_LEGAL_PREMARKET_SNAPSHOT: '盤前合法 Market State 快照未建立',
  PREVIOUS_GOVERNED_TRADE_DATE_SOURCE_MISSING: '前一官方交易日的合法來源資料不存在',
  LATE_START_AFTER_OBSERVATION: 'Observer 晚於合法觀察起點啟動',
  OBSERVER_NOT_STARTED: 'Observer 未啟動',
  PC_OFFLINE: '執行電腦未在線',
  SCHEDULER_MISSED: '排程未觸發',
});

function lifecycleStages(dailyStatus) {
  return Array.isArray(dailyStatus?.lifecycle) ? dailyStatus.lifecycle : [];
}

function failedStageFor(reasonCode, lifecycle) {
  if (reasonCode === 'NO_LEGAL_PREMARKET_SNAPSHOT' || reasonCode === 'PREVIOUS_GOVERNED_TRADE_DATE_SOURCE_MISSING') {
    return 'INPUT_AVAILABILITY_CHECK';
  }
  if (reasonCode === 'LATE_START_AFTER_OBSERVATION' || reasonCode === 'OBSERVER_NOT_STARTED' || reasonCode === 'SCHEDULER_MISSED') {
    return 'PRECHECK';
  }
  return lifecycle.includes('AUDIT_RECONCILIATION') ? 'AUDIT_RECONCILIATION' : 'UNKNOWN';
}

function lastSuccessfulStage(reasonCode, lifecycle) {
  const failed = failedStageFor(reasonCode, lifecycle);
  const index = lifecycle.indexOf(failed);
  if (index > 0) return lifecycle[index - 1];
  if (reasonCode === 'NO_LEGAL_PREMARKET_SNAPSHOT' || reasonCode === 'PREVIOUS_GOVERNED_TRADE_DATE_SOURCE_MISSING') {
    return 'TRADING_DAY_CHECK';
  }
  return null;
}

export function explainForwardShadowStatus({ stateRecord = null, dailyStatus = null, stateTask = null, outcomeTask = null } = {}) {
  const currentSchedulerReady = stateTask?.enabled === true && outcomeTask?.enabled === true;
  const schedulerReadiness = Object.freeze({
    currentState: currentSchedulerReady ? 'READY' : 'UNAVAILABLE',
    historicalStateAtTradeDate: 'UNKNOWN',
    stateTaskEnabled: stateTask?.enabled === true,
    outcomeTaskEnabled: outcomeTask?.enabled === true,
  });
  if (!stateRecord) {
    return Object.freeze({
      status: 'UNKNOWN',
      reasonCode: 'UNKNOWN_INSUFFICIENT_EVIDENCE',
      reasonSummary: '沒有足夠的官方證據判定該交易日狀態',
      tradeDate: null,
      expectedAt: null,
      observedAt: null,
      availableAt: null,
      lastSuccessfulStage: null,
      failedStage: 'UNKNOWN',
      evidenceSource: 'UNAVAILABLE',
      dataTrust: 'UNAVAILABLE',
      runtimeVersion: null,
      schedulerReadiness,
    });
  }
  if (!['STATE', 'SESSION_STATUS'].includes(stateRecord.recordType) || !/^\d{4}-\d{2}-\d{2}$/.test(stateRecord.tradeDate || '')) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      reasonCode: 'UNKNOWN_INSUFFICIENT_EVIDENCE',
      reasonSummary: '官方狀態證據格式不完整，無法判定',
      tradeDate: null,
      expectedAt: null,
      observedAt: null,
      availableAt: null,
      lastSuccessfulStage: null,
      failedStage: 'UNKNOWN',
      evidenceSource: 'MALFORMED_GOVERNED_EVIDENCE',
      dataTrust: 'UNAVAILABLE',
      runtimeVersion: null,
      schedulerReadiness,
    });
  }
  const lifecycle = lifecycleStages(dailyStatus);
  if (stateRecord.recordType === 'SESSION_STATUS' && stateRecord.qualityStatus === 'MISSED') {
    const reasonCode = stateRecord.missedReason || dailyStatus?.unavailableReason || 'UNKNOWN_INSUFFICIENT_EVIDENCE';
    return Object.freeze({
      status: 'MISSED',
      reasonCode,
      reasonSummary: REASON_SUMMARIES[reasonCode] || '官方紀錄未提供足夠的 MISSED 根因證據',
      tradeDate: stateRecord.tradeDate || dailyStatus?.tradeDate || null,
      expectedAt: stateRecord.scheduledAt || null,
      observedAt: stateRecord.recordedAt || null,
      availableAt: null,
      lastSuccessfulStage: lastSuccessfulStage(reasonCode, lifecycle),
      failedStage: failedStageFor(reasonCode, lifecycle),
      evidenceSource: 'OFFICIAL_APPEND_ONLY_LEDGER',
      dataTrust: reasonCode === 'UNKNOWN_INSUFFICIENT_EVIDENCE' ? 'UNAVAILABLE' : 'GOVERNED',
      runtimeVersion: null,
      schedulerReadiness,
    });
  }
  return Object.freeze({
    status: stateRecord.qualityStatus || 'UNKNOWN',
    reasonCode: stateRecord.unavailableReason || null,
    reasonSummary: stateRecord.unavailableReason ? (REASON_SUMMARIES[stateRecord.unavailableReason] || '官方狀態紀錄') : '官方狀態紀錄',
    tradeDate: stateRecord.tradeDate || null,
    expectedAt: stateRecord.decisionAt || null,
    observedAt: stateRecord.recordedAt || null,
    availableAt: stateRecord.availableAt || null,
    lastSuccessfulStage: lifecycle.at(-1) || null,
    failedStage: null,
    evidenceSource: 'OFFICIAL_APPEND_ONLY_LEDGER',
    dataTrust: 'GOVERNED',
    runtimeVersion: null,
    schedulerReadiness,
  });
}
