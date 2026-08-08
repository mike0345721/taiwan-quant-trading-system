import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SETTLEMENT_CLASSES = Object.freeze({
  NORMAL: 'NORMAL_SESSION',
  FINAL: 'SETTLEMENT_FINAL_CONTRACT',
  NON_FINAL: 'SETTLEMENT_NON_FINAL_CONTRACT',
  UNAVAILABLE: 'SETTLEMENT_STATUS_UNAVAILABLE',
});

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashJson(value) {
  return sha256(stableStringify(value));
}

export function taxSourceHash(costPolicy) {
  const tax = costPolicy.tax;
  return hashJson({
    futuresTransactionTaxRate: tax.futuresTransactionTaxRate,
    calculation: tax.calculation,
    taxEffectiveFrom: tax.taxEffectiveFrom,
    taxSource: tax.taxSource,
    taxSourceUrl: tax.taxSourceUrl,
    taxRuleVersion: tax.taxRuleVersion,
  });
}

export function taxPerSide(actualFillIndex, instrument, costPolicy) {
  const product = costPolicy.instruments[instrument];
  if (!product?.contractMultiplier) throw new Error(`NO_FUTURES_MULTIPLIER:${instrument}`);
  if (!Number.isFinite(actualFillIndex) || actualFillIndex <= 0) throw new Error('INVALID_FILL_INDEX');
  return Math.round(actualFillIndex * product.contractMultiplier * costPolicy.tax.futuresTransactionTaxRate);
}

export function calculateTradeCost({ instrument, entryIndex, exitIndex, direction, slippageTicksPerSide }, costPolicy) {
  const product = costPolicy.instruments[instrument];
  if (!product?.contractMultiplier) throw new Error(`UNSUPPORTED_T0_INSTRUMENT:${instrument}`);
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  if (![entryIndex, exitIndex, slippageTicksPerSide].every(Number.isFinite)) throw new Error('INVALID_COST_INPUT');
  const sign = direction === 'LONG' ? 1 : -1;
  const grossPnl = (exitIndex - entryIndex) * sign * product.contractMultiplier;
  const entrySlippagePoints = slippageTicksPerSide * product.tickSizeIndexPoints;
  const exitSlippagePoints = slippageTicksPerSide * product.tickSizeIndexPoints;
  const actualEntryFillIndex = direction === 'LONG' ? entryIndex + entrySlippagePoints : entryIndex - entrySlippagePoints;
  const actualExitFillIndex = direction === 'LONG' ? exitIndex - exitSlippagePoints : exitIndex + exitSlippagePoints;
  const entryCommission = product.commissionPerSideTwd;
  const exitCommission = product.commissionPerSideTwd;
  const entryTax = taxPerSide(actualEntryFillIndex, instrument, costPolicy);
  const exitTax = taxPerSide(actualExitFillIndex, instrument, costPolicy);
  const entrySlippage = entrySlippagePoints * product.contractMultiplier;
  const exitSlippage = exitSlippagePoints * product.contractMultiplier;
  const totalCost = entryCommission + exitCommission + entryTax + exitTax + entrySlippage + exitSlippage;
  return { grossPnl, actualEntryFillIndex, actualExitFillIndex, entryCommission, exitCommission, entryTax, exitTax, entrySlippage, exitSlippage, totalCost, netPnl: grossPnl - totalCost };
}

export function resolveGapThroughStopReference({ direction, stopIndex, firstLegalAdverseFillIndex }) {
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  if (![stopIndex, firstLegalAdverseFillIndex].every(Number.isFinite)) throw new Error('INVALID_GAP_STOP_INPUT');
  const isAdverse = direction === 'LONG' ? firstLegalAdverseFillIndex <= stopIndex : firstLegalAdverseFillIndex >= stopIndex;
  if (!isAdverse) throw new Error('FIRST_LEGAL_FILL_NOT_ADVERSE_TO_STOP');
  return {
    referenceExitIndex: firstLegalAdverseFillIndex,
    referenceSource: 'FIRST_LEGAL_ADVERSE_FILL_PRICE',
    stopIndex,
    gapPointsBeyondStop: Math.abs(firstLegalAdverseFillIndex - stopIndex),
  };
}

function adverseSlippage(price, direction, ticks, tickSize = 1) {
  return direction === 'LONG' ? price - ticks * tickSize : price + ticks * tickSize;
}

export function resolveBarStopExit({ direction, stopPrice, barOpen, barHigh, barLow, slippageTicks, tickSize = 1 }) {
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  if (![stopPrice, barOpen, barHigh, barLow, slippageTicks, tickSize].every(Number.isFinite)) throw new Error('INVALID_BAR_STOP_INPUT');
  let baseFill = null;
  if (direction === 'LONG') {
    if (barOpen <= stopPrice) baseFill = barOpen;
    else if (barLow <= stopPrice) baseFill = stopPrice;
  } else {
    if (barOpen >= stopPrice) baseFill = barOpen;
    else if (barHigh >= stopPrice) baseFill = stopPrice;
  }
  if (baseFill == null) return null;
  return { exitReason: 'STOP_EXIT', baseFill, finalFill: adverseSlippage(baseFill, direction, slippageTicks, tickSize) };
}

export function resolveTickStopExit({ direction, stopPrice, ticks, slippageTicks, tickSize = 1 }) {
  if (!Array.isArray(ticks)) throw new Error('INVALID_TICK_REPLAY');
  const crossing = ticks.find((tick) => Number.isFinite(tick?.price)
    && (direction === 'LONG' ? tick.price <= stopPrice : tick.price >= stopPrice));
  if (!crossing) return null;
  return { exitReason: 'STOP_EXIT', baseFill: crossing.price, finalFill: adverseSlippage(crossing.price, direction, slippageTicks, tickSize), exchangeTimestamp: crossing.exchangeTimestamp };
}

export function resolveTimeExit({ entryTimestamp, direction, ticks = null, bars = null, slippageTicks, tickSize = 1 }) {
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  const entryMs = Date.parse(entryTimestamp);
  if (!Number.isFinite(entryMs) || !Number.isFinite(slippageTicks)) throw new Error('INVALID_TIME_EXIT_INPUT');
  const timeExitAt = new Date(entryMs + 60 * 60_000).toISOString();
  let sourceType;
  let reference;
  if (Array.isArray(ticks)) {
    sourceType = 'TICK_REPLAY';
    reference = ticks.find((tick) => tick?.exchangeTimestamp >= timeExitAt && Number.isFinite(tick?.price));
    if (reference) reference = { timestamp: reference.exchangeTimestamp, price: reference.price };
  } else if (Array.isArray(bars)) {
    sourceType = 'FIVE_MINUTE_OPEN_FALLBACK';
    reference = bars.find((bar) => bar?.complete === true && bar?.timestamp >= timeExitAt && Number.isFinite(bar?.open));
    if (reference) reference = { timestamp: reference.timestamp, price: reference.open };
  } else {
    throw new Error('TIME_EXIT_REPLAY_SOURCE_REQUIRED');
  }
  if (!reference) return { sampleState: 'NO_SAMPLE', noSampleReason: 'TIME_EXIT_PRICE_UNAVAILABLE', timeExitAt };
  return {
    sampleState: 'ELIGIBLE',
    exitReason: 'TIME_EXIT',
    timeExitAt,
    referenceTimestamp: reference.timestamp,
    referencePrice: reference.price,
    finalFill: adverseSlippage(reference.price, direction, slippageTicks, tickSize),
    sourceType,
  };
}

export function evaluateEntryWindow({ confirmationBarStart, confirmationBarEnd, entryTimestamp }) {
  const confirmationStartTime = confirmationBarStart?.slice(11, 19);
  const confirmationEndTime = confirmationBarEnd?.slice(11, 19);
  const entryTime = entryTimestamp?.slice(11, 19);
  const pass = confirmationStartTime >= '09:00:00' && confirmationStartTime <= '09:55:00'
    && confirmationEndTime <= '10:00:00' && entryTime <= '10:00:00';
  return pass ? { tradeState: 'ELIGIBLE', noTradeReason: null } : { tradeState: 'NO_TRADE', noTradeReason: 'ENTRY_WINDOW_EXPIRED' };
}

export function evaluateEntryGapThroughStop({ direction, entryOpen, stopPrice }) {
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  if (![entryOpen, stopPrice].every(Number.isFinite)) throw new Error('INVALID_ENTRY_GAP_INPUT');
  const crossed = direction === 'LONG' ? entryOpen <= stopPrice : entryOpen >= stopPrice;
  if (!crossed) return { tradeState: 'ELIGIBLE', noTradeReason: null, breakoutDirection: direction, entryPrice: entryOpen };
  return {
    tradeState: 'NO_TRADE', noTradeReason: 'ENTRY_GAP_THROUGH_STOP', breakoutDirection: direction,
    entryPrice: null, exitPrice: null, grossPnl: null, netPnl: null,
    commission: 0, tax: 0, slippage: 0, countsAsTrade: false, countsAsEligibleSession: true,
  };
}

function favorableReached(direction, price, entryPrice, oneR) {
  return direction === 'LONG' ? price >= entryPrice + oneR : price <= entryPrice - oneR;
}

function stopReached(direction, price, stopPrice) {
  return direction === 'LONG' ? price <= stopPrice : price >= stopPrice;
}

export function diagnoseFalseBreakout({ direction, entryPrice, initialStopPrice, orHigh, orLow, observationBars }) {
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  if (![entryPrice, initialStopPrice, orHigh, orLow].every(Number.isFinite)) throw new Error('INVALID_FALSE_BREAKOUT_INPUT');
  const bars = Array.isArray(observationBars) ? observationBars.slice(0, 3) : [];
  const complete = bars.length === 3 && bars.every((bar) => bar?.complete === true && Number.isFinite(bar?.close)
    && Array.isArray(bar?.pricePath) && bar.pricePath.length > 0
    && bar.pricePath.every((point) => Number.isFinite(point?.price) && typeof point?.exchangeTimestamp === 'string'));
  if (!complete) return { falseBreakout: 'UNAVAILABLE', falseBreakoutQualityState: 'UNAVAILABLE', falseBreakoutDirection: direction, falseBreakoutReason: 'FALSE_BREAKOUT_PRICE_PATH_UNAVAILABLE' };
  const oneR = Math.abs(entryPrice - initialStopPrice);
  if (!(oneR > 0)) throw new Error('INVALID_R_DISTANCE');
  let reachedOneR = false;
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const orderedPath = [...bar.pricePath].sort((a, b) => a.exchangeTimestamp.localeCompare(b.exchangeTimestamp));
    for (const point of orderedPath) {
      if (favorableReached(direction, point.price, entryPrice, oneR)) reachedOneR = true;
      if (!reachedOneR && stopReached(direction, point.price, initialStopPrice)) return { falseBreakout: true, falseBreakoutQualityState: 'PASS', falseBreakoutDirection: direction, falseBreakoutReason: 'STOPPED_WITHIN_FALSE_BREAKOUT_WINDOW', observationBarNumber: index + 1 };
    }
    const returned = direction === 'LONG' ? bar.close <= orHigh : bar.close >= orLow;
    if (returned) return reachedOneR
      ? { falseBreakout: false, falseBreakoutQualityState: 'PASS', falseBreakoutDirection: direction, falseBreakoutReason: 'FAVORABLE_1R_REACHED_BEFORE_OR_RETURN', observationBarNumber: index + 1 }
      : { falseBreakout: true, falseBreakoutQualityState: 'PASS', falseBreakoutDirection: direction, falseBreakoutReason: direction === 'LONG' ? 'RETURNED_BELOW_OR_HIGH_BEFORE_1R' : 'RETURNED_ABOVE_OR_LOW_BEFORE_1R', observationBarNumber: index + 1 };
  }
  return { falseBreakout: false, falseBreakoutQualityState: 'PASS', falseBreakoutDirection: direction, falseBreakoutReason: reachedOneR ? 'FAVORABLE_1R_REACHED_WITHIN_WINDOW' : 'NO_OR_RETURN_WITHIN_THREE_BARS' };
}

export function calculateRvol20({ currentTradeDate, currentSessionId, currentSessionType, timeBucket, currentCumulativeVolume, referenceSessions }) {
  if (currentSessionType !== 'DAY' || !Number.isFinite(currentCumulativeVolume)) return { value: null, qualityState: 'UNAVAILABLE', validSessions: 0 };
  const eligible = referenceSessions
    .filter((row) => row.tradeDate < currentTradeDate
      && row.sessionId !== currentSessionId
      && row.sessionType === currentSessionType
      && row.timeBucket === timeBucket
      && row.isSettlementSession !== true
      && row.rollSession !== true
      && Number.isFinite(row.cumulativeVolume))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    .slice(-20);
  if (eligible.length < 15) return { value: null, qualityState: 'UNAVAILABLE', validSessions: eligible.length };
  const mean = eligible.reduce((sum, row) => sum + row.cumulativeVolume, 0) / eligible.length;
  if (!(mean > 0)) return { value: null, qualityState: 'UNAVAILABLE', validSessions: eligible.length };
  return { value: currentCumulativeVolume / mean, qualityState: 'PASS', validSessions: eligible.length, referenceTradeDates: eligible.map((row) => row.tradeDate) };
}

export function classifySettlementSession({ tradeDate, contractCode, contractMasterRows }) {
  const monthlyRows = contractMasterRows.filter((row) => row.product === 'TX' && row.expiryDate === tradeDate);
  if (monthlyRows.length === 0) return SETTLEMENT_CLASSES.NORMAL;
  if (!contractCode) return SETTLEMENT_CLASSES.UNAVAILABLE;
  const selected = contractMasterRows.find((row) => row.product === 'TX' && row.contractCode === contractCode);
  if (!selected?.expiryDate || !selected?.finalTradingTimestamp) return SETTLEMENT_CLASSES.UNAVAILABLE;
  return selected.expiryDate === tradeDate ? SETTLEMENT_CLASSES.FINAL : SETTLEMENT_CLASSES.NON_FINAL;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expectedBarTimestamps(tradeDate) {
  const start = Date.parse(`${tradeDate}T00:45:00.000Z`);
  return Array.from({ length: 60 }, (_, index) => new Date(start + index * 300_000).toISOString());
}

export function validateDayReplay(payload) {
  const expected = expectedBarTimestamps(payload.tradeDate);
  const bars = Array.isArray(payload.bars) ? payload.bars : [];
  const complete = bars.length === 60 && bars.every((bar, index) =>
    bar.complete === true
    && bar.timestamp === expected[index]
    && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
    && bar.volume >= 0);
  return {
    pass: payload.product === 'TX' && payload.session === 'day' && payload.timeframe === '5m' && /^\d{6}$/.test(payload.contract || '') && complete,
    barCount: bars.length,
    completeBars: bars.filter((bar) => bar.complete === true).length,
    firstTimestamp: bars[0]?.timestamp || null,
    lastTimestamp: bars.at(-1)?.timestamp || null,
  };
}

function selectedResearchForSession(selectionSets, sessionId) {
  return selectionSets.find((set) => set.sessionId === sessionId)?.records?.find((row) => row.contractRole === 'SELECTED_RESEARCH') || null;
}

export function auditT0Replay({ archiveDir, pp1ArtifactsDir, costPolicy, t0Spec }) {
  const p02 = readJson(path.join(pp1ArtifactsDir, 'P02.json'));
  const p04 = readJson(path.join(pp1ArtifactsDir, 'P04.json'));
  const p05 = readJson(path.join(pp1ArtifactsDir, 'P05.json'));
  const contractMasterRows = p02.contractMaster.rows;
  const dayContexts = new Map(p04.contexts.filter((row) => row.sessionType === 'DAY').map((row) => [row.tradeDate, row]));
  const dayFiles = fs.readdirSync(archiveDir).filter((name) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(name)).sort();
  const productFiles = { TX: 0, MTX: 0, TMF: 0 };
  const sessions = [];
  let priorContract = null;
  for (const name of dayFiles) {
    const payload = readJson(path.join(archiveDir, name));
    if (Object.hasOwn(productFiles, payload.product)) productFiles[payload.product] += 1;
    const context = dayContexts.get(payload.tradeDate);
    const replay = validateDayReplay(payload);
    const auditPath = path.join(archiveDir, `${payload.tradeDate}-audit.json`);
    const audit = fs.existsSync(auditPath) ? readJson(auditPath) : null;
    const selectedResearch = context ? selectedResearchForSession(p05.sets, context.sessionId) : null;
    const settlementClass = classifySettlementSession({ tradeDate: payload.tradeDate, contractCode: payload.contract, contractMasterRows });
    const contractKnown = contractMasterRows.some((row) => row.product === 'TX' && row.contractCode === payload.contract);
    const contractSelectionMatch = selectedResearch?.contractCode === payload.contract;
    const replayAvailableAt = audit?.generatedAt || null;
    const timestampLineageComplete = Boolean(replayAvailableAt && replay.firstTimestamp && replay.lastTimestamp);
    const rollSession = priorContract !== null && priorContract !== payload.contract;
    const researchEligible = replay.pass && contractKnown && timestampLineageComplete && Boolean(context) && contractSelectionMatch && settlementClass !== SETTLEMENT_CLASSES.UNAVAILABLE;
    sessions.push({
      tradeDate: payload.tradeDate,
      sessionId: context?.sessionId || null,
      product: payload.product,
      replayContractCode: payload.contract,
      pp1SelectedResearchContractCode: selectedResearch?.contractCode || null,
      contractSelectionMatch,
      settlementClass,
      rollSession,
      replayAvailableAt,
      timestampLineageComplete,
      replayQualityPass: replay.pass,
      contractKnown,
      researchEligible,
      noSampleReason: researchEligible ? null : !context ? 'SESSION_CONTEXT_MISSING' : !replay.pass ? 'REPLAY_QUALITY_FAILED' : !contractKnown ? 'CONTRACT_UNKNOWN' : !timestampLineageComplete ? 'TIMESTAMP_LINEAGE_INCOMPLETE' : !contractSelectionMatch ? 'PP1_SELECTED_RESEARCH_CONTRACT_MISMATCH' : 'SETTLEMENT_STATUS_UNAVAILABLE',
      replay,
    });
    priorContract = payload.contract;
  }
  const counts = {
    totalDaySessions: sessions.length,
    normalSessions: sessions.filter((row) => row.settlementClass === SETTLEMENT_CLASSES.NORMAL).length,
    settlementSessions: sessions.filter((row) => [SETTLEMENT_CLASSES.FINAL, SETTLEMENT_CLASSES.NON_FINAL].includes(row.settlementClass)).length,
    settlementFinalContractSessions: sessions.filter((row) => row.settlementClass === SETTLEMENT_CLASSES.FINAL).length,
    settlementNonFinalContractSessions: sessions.filter((row) => row.settlementClass === SETTLEMENT_CLASSES.NON_FINAL).length,
    settlementStatusUnavailable: sessions.filter((row) => row.settlementClass === SETTLEMENT_CLASSES.UNAVAILABLE).length,
    rollSessions: sessions.filter((row) => row.rollSession).length,
    researchEligibleSessions: sessions.filter((row) => row.researchEligible).length,
    contractSelectionMismatchSessions: sessions.filter((row) => !row.contractSelectionMatch).length,
  };
  const productAvailability = Object.fromEntries(Object.entries(productFiles).map(([instrument, actualReplaySessions]) => [instrument, {
    actualReplaySessions,
    actualReplayAvailable: actualReplaySessions > 0,
    indicativeCostScenarioOnly: instrument === 'TX' ? false : actualReplaySessions === 0,
    executionValidated: false,
    note: instrument === 'TX' ? 'T0 principal historical replay; execution is not authorized.' : actualReplaySessions === 0 ? 'No instrument-specific replay; TX fills must not be represented as this instrument.' : 'Instrument-specific replay exists but execution remains unauthorized.',
  }]));
  const gates = {
    pp1ArtifactsPresent: true,
    allReplayRowsQualityPass: sessions.every((row) => row.replayQualityPass),
    allContractsKnown: sessions.every((row) => row.contractKnown),
    allTimestampLineageComplete: sessions.every((row) => row.timestampLineageComplete),
    settlementClassificationComplete: counts.settlementStatusUnavailable === 0,
    pp1SelectedResearchContractAligned: counts.contractSelectionMismatchSessions === 0,
    txOwnReplayAvailable: productAvailability.TX.actualReplayAvailable,
    noMtxTmfMisrepresentation: productAvailability.MTX.indicativeCostScenarioOnly && productAvailability.TMF.indicativeCostScenarioOnly,
    formalWeightZero: t0Spec.authorization.formalWeight === 0,
    researchOnly: t0Spec.authorization.researchOnly === true,
    executionAuthorizedFalse: t0Spec.authorization.executionAuthorized === false,
  };
  const overallGateStatus = Object.values(gates).every(Boolean) ? 'PASS' : 'PENDING';
  return {
    schemaVersion: '1.0.0',
    gateId: 'T0_DATA_REPLAY_GATE_V1',
    generatedAt: sessions.map((row) => row.replayAvailableAt).filter(Boolean).sort().at(-1) || null,
    overallGateStatus,
    gateMeaning: overallGateStatus === 'PASS' ? 'T0資料與重播輸入符合凍結Gate；這仍不構成H0 Run授權。' : '至少一項凍結資料／重播要求尚未解決；T0歷史H0 Run未獲授權。',
    costPolicyHash: hashJson(costPolicy),
    taxSourceHash: taxSourceHash(costPolicy),
    t0SpecHash: hashJson(t0Spec),
    pp1PolicySpecHash: p05.sets[0]?.policySpecHash || null,
    gates,
    counts,
    productAvailability,
    mismatches: sessions.filter((row) => !row.researchEligible).map((row) => ({ tradeDate: row.tradeDate, noSampleReason: row.noSampleReason, replayContractCode: row.replayContractCode, pp1SelectedResearchContractCode: row.pp1SelectedResearchContractCode, settlementClass: row.settlementClass })),
    sessions,
    authorization: t0Spec.authorization,
  };
}
