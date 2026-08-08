import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  aggregateForwardBars,
  appendForwardRegistryRecord,
  auditForwardRegistry,
  buildForwardFeatureRow,
  calculateForwardSeverities,
  classifyForwardAttempt,
  FORWARD_ATTEMPT_STATUS,
  isEligibleTxTick,
  predictFrozenModels,
  readForwardRegistry,
  resolveFrozenOutcomes,
  tickMinuteOfDay,
} from '../src/v310-forward-operations.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forwardDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-wave3-forward');
const specPath = path.join(forwardDir, 'restricted-frozen-spec.json');
const modelsPath = path.join(forwardDir, 'restricted-frozen-models.json');
const registryPath = path.join(forwardDir, 'restricted-forward-registry.jsonl');
const discoveryPath = path.join(
  root, 'data', 'intraday', 'research', 'v3.10-restricted-wave3', 'aligned-discovery.ndjson',
);
const archiveDir = path.join(root, 'data', 'intraday', 'archive');
const databasePath = path.join(root, 'v2', 'data', 'research-v2.sqlite');
const statusPath = path.join(forwardDir, 'operations-status.json');
const lockPath = path.join(forwardDir, '.operations.lock');
const bridgeHealthUrl = 'http://127.0.0.1:8790/health';
const pollMs = 250;
const stopMinutes = 13 * 60 + 50;
const predictionDeadlineMinutes = 9 * 60 + 2;

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function liveRecordHash(previousHash, body) {
  return crypto.createHash('sha256')
    .update(`${previousHash}\n${JSON.stringify(stable(body))}`).digest('hex');
}

function taipeiParts(at = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
}

function taipeiTradeDate(at = new Date()) {
  const parts = taipeiParts(at);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function taipeiMinutes(at = new Date()) {
  const parts = taipeiParts(at);
  return Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

function readNdjson(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function loadHistoricalDays(tradeDate) {
  return fs.readdirSync(archiveDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(name)
      && name.slice(0, 10) < tradeDate)
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(archiveDir, name), 'utf8')));
}

function latestBefore(db, table, fields, tradeDate) {
  return db.prepare(
    `SELECT ${fields} FROM ${table} WHERE trade_date < ? ORDER BY trade_date DESC LIMIT 1`,
  ).get(tradeDate);
}

function loadRawFactors(tradeDate, decisionAt = new Date()) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const market = latestBefore(db, 'market_daily', 'trade_date', tradeDate);
    const basis = latestBefore(
      db, 'basis_term_structure_daily', 'trade_date, term_spread_bps', tradeDate,
    );
    const oi = latestBefore(db, 'futures_oi_daily', 'trade_date, research_oi', tradeDate);
    const priorOi = oi
      ? latestBefore(db, 'futures_oi_daily', 'trade_date, research_oi', oi.trade_date)
      : null;
    const volatility = market ? db.prepare(`
      SELECT trade_date, contract, expiry_date, skew_25d, available_at, observations
      FROM option_volatility_daily
      WHERE trade_date = ? AND expiry_date >= ? AND skew_25d IS NOT NULL
      ORDER BY expiry_date ASC, observations DESC
      LIMIT 1
    `).get(market.trade_date, tradeDate) : null;
    const volatilityAvailableAt = volatility?.available_at
      ? Date.parse(volatility.available_at)
      : Number.NaN;
    const volatilityWasAvailable = !volatility
      || (Number.isFinite(volatilityAvailableAt)
        && volatilityAvailableAt < decisionAt.getTime());
    return {
      factorSourceDate: market?.trade_date ?? null,
      termSpreadBps: basis?.term_spread_bps ?? null,
      skew25d: volatilityWasAvailable ? (volatility?.skew_25d ?? null) : null,
      marketOiDeltaPct: oi && priorOi && Number(priorOi.research_oi) !== 0
        ? (Number(oi.research_oi) - Number(priorOi.research_oi))
          / Number(priorOi.research_oi)
        : null,
      sourceEvidence: {
        basisDate: basis?.trade_date ?? null,
        oiDate: oi?.trade_date ?? null,
        priorOiDate: priorOi?.trade_date ?? null,
        volatilityDate: volatility?.trade_date ?? null,
        volatilityAvailableAt: volatility?.available_at ?? null,
        volatilityWasAvailable,
      },
    };
  } finally {
    db.close();
  }
}

function loadRankHistory(registry) {
  const discovery = readNdjson(discoveryPath);
  const forwardFeatures = registry
    .filter((record) => record.eventType === 'feature_input')
    .map((record) => record.features);
  return [...discovery, ...forwardFeatures]
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
}

async function bridgeHealth() {
  try {
    const response = await fetch(bridgeHealthUrl, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return null;
    const value = await response.json();
    return {
      ok: value.ok === true,
      processId: Number(value.processId) || null,
      callbackErrors: Number(value.callbackErrors) || 0,
      dropped: Number(value.dropped) || 0,
      writerErrors: Number(value.writerErrors) || 0,
      eventQueueDepth: Number(value.eventQueueDepth) || 0,
      sessionDown: value.sessionDown === true,
      executionAuthorized: value.executionAuthorized,
      orderRoutesEnabled: value.orderRoutesEnabled,
      latestReceivedAt: value.latestReceivedAt ?? null,
    };
  } catch {
    return null;
  }
}

function healthGate(health) {
  return Boolean(health?.ok)
    && health.callbackErrors === 0
    && health.dropped === 0
    && health.writerErrors === 0
    && health.sessionDown === false
    && health.executionAuthorized === false
    && health.orderRoutesEnabled === false;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recordRejection(tradeDate, reason, details = {}) {
  const attemptStatus = classifyForwardAttempt({ reason, details });
  return appendForwardRegistryRecord(registryPath, {
    eventType: 'day_rejected',
    idempotencyKey: `day_rejected:${tradeDate}:${reason}`,
    tradeDate,
    reason,
    attemptStatus,
    recordedAt: new Date().toISOString(),
    ...details,
  });
}

function acquireLock(tradeDate) {
  fs.mkdirSync(forwardDir, { recursive: true });
  try {
    const handle = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(handle, JSON.stringify({
      pid: process.pid,
      tradeDate,
      startedAt: new Date().toISOString(),
    }));
    return handle;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let active = true;
    try {
      const prior = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      process.kill(Number(prior.pid), 0);
    } catch {
      active = false;
    }
    if (active) throw new Error('forward_operations_already_running');
    fs.unlinkSync(lockPath);
    return acquireLock(tradeDate);
  }
}

function verifyFrozenArtifacts(spec, models, registry) {
  const specHash = sha256(fs.readFileSync(specPath));
  const modelsHash = sha256(fs.readFileSync(modelsPath));
  const frozenRecord = registry.find((record) => record.eventType === 'models_frozen');
  if (models.frozenSpecSha256 !== specHash || frozenRecord?.frozenSpecSha256 !== specHash) {
    throw new Error('frozen_spec_hash_mismatch');
  }
  if (frozenRecord?.frozenModelsSha256 !== modelsHash) {
    throw new Error('frozen_models_hash_mismatch');
  }
  if (models.models.length !== 12) throw new Error('frozen_model_count_changed');
  if (spec.executionAuthorized !== false || models.executionAuthorized !== false
    || spec.researchOnly !== true || models.researchOnly !== true) {
    throw new Error('frozen_execution_boundary_invalid');
  }
  return { specHash, modelsHash };
}

function appendPredictions({
  tradeDate,
  features,
  predictions,
  artifactHashes,
  sourceEvidence,
  health,
  inputCutoff,
}) {
  const recordedAt = new Date().toISOString();
  const targetAvailableAt = `${tradeDate}T10:00:00+08:00`;
  const featureResult = appendForwardRegistryRecord(registryPath, {
    eventType: 'feature_input',
    idempotencyKey: `feature_input:${tradeDate}`,
    tradeDate,
    recordedAt,
    decisionAvailableAt: `${tradeDate}T09:00:00+08:00`,
    inputCutoffExchangeTimestamp: inputCutoff,
    frozenSpecSha256: artifactHashes.specHash,
    frozenModelsSha256: artifactHashes.modelsHash,
    sourceEvidence,
    operationalHealth: health,
    features,
  });
  const records = [];
  for (const prediction of predictions) {
    const result = appendForwardRegistryRecord(registryPath, {
      eventType: 'prediction',
      idempotencyKey: `prediction:${tradeDate}:${prediction.modelKey}`,
      tradeDate,
      modelKey: prediction.modelKey,
      hypothesisId: prediction.hypothesisId,
      targetName: prediction.targetName,
      primaryTarget: prediction.primaryTarget,
      recordedAt,
      targetAvailableAt,
      featureInputRecordHash: featureResult.record.recordHash,
      frozenSpecSha256: artifactHashes.specHash,
      frozenModelsSha256: artifactHashes.modelsHash,
      eventThreshold: prediction.eventThreshold,
      predictions: prediction.predictions,
      formalModelWeight: 0,
      promotionAuthorized: false,
    });
    records.push(result.record);
  }
  return records;
}

function appendOutcomes({
  tradeDate,
  outcomes,
  predictions,
  severities,
  health,
}) {
  const recordedAt = new Date().toISOString();
  const targetAvailableAt = `${tradeDate}T10:00:00+08:00`;
  const predictionByKey = new Map(predictions.map((record) => [record.modelKey, record]));
  const records = [];
  for (const outcome of outcomes) {
    const prediction = predictionByKey.get(outcome.modelKey);
    if (!prediction) throw new Error(`prediction_missing:${outcome.modelKey}`);
    const result = appendForwardRegistryRecord(registryPath, {
      eventType: 'outcome',
      idempotencyKey: `outcome:${tradeDate}:${outcome.modelKey}`,
      tradeDate,
      modelKey: outcome.modelKey,
      hypothesisId: outcome.hypothesisId,
      targetName: outcome.targetName,
      recordedAt,
      targetAvailableAt,
      predictionRecordHash: prediction.recordHash,
      severityKey: outcome.severityKey,
      severity: outcome.severity,
      eventThreshold: outcome.eventThreshold,
      actualEvent: outcome.actualEvent,
      anchorPrice: severities.anchorPrice,
      targetClose: severities.targetClose,
      targetAvailableAtExchange: severities.targetAvailableAtExchange,
      operationalHealth: health,
      formalModelWeight: 0,
      promotionAuthorized: false,
    });
    records.push(result.record);
  }
  return records;
}

async function observe() {
  const startedAt = new Date();
  const tradeDate = arg('trade-date') || taipeiTradeDate(startedAt);
  const parts = taipeiParts(startedAt);
  if (['Sat', 'Sun'].includes(parts.weekday)) {
    console.log(JSON.stringify({ status: 'SKIPPED_NON_TRADING_DAY', tradeDate }));
    return;
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const models = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
  let registry = readForwardRegistry(registryPath);
  const initialAudit = auditForwardRegistry(registry);
  if (!initialAudit.ok) throw new Error(`forward_registry_invalid:${initialAudit.errors.join(',')}`);
  const artifactHashes = verifyFrozenArtifacts(spec, models, registry);
  if (tradeDate < spec.earliestEligibleTradeDate) {
    recordRejection(tradeDate, 'before_earliest_eligible_trade_date', {
      earliestEligibleTradeDate: spec.earliestEligibleTradeDate,
    });
    return;
  }
  const startMinutes = taipeiMinutes(startedAt);
  if (startMinutes >= 8 * 60 + 45) {
    recordRejection(tradeDate, 'observer_started_after_day_session_open', {
      observerStartedAt: startedAt.toISOString(),
    });
    return;
  }
  const ledgerPath = path.join(root, 'data', 'live-events', `${tradeDate}.ndjson`);
  let position = fs.existsSync(ledgerPath) ? fs.statSync(ledgerPath).size : 0;
  let pending = '';
  let previousObservedHash = null;
  const sourceAudit = {
    observedLines: 0,
    invalidLines: 0,
    hashFailures: 0,
    sequenceGaps: 0,
    duplicates: 0,
    allClockSkewEvents: 0,
    txTargetWindowClockSkewEvents: 0,
    executionBoundaryErrors: 0,
    firstTxTickMinute: null,
    lastTxTickMinute: null,
  };
  const ticks = [];
  let predictionRecords = registry.filter(
    (record) => record.eventType === 'prediction' && record.tradeDate === tradeDate,
  );
  let outcomeRecords = registry.filter(
    (record) => record.eventType === 'outcome' && record.tradeDate === tradeDate,
  );
  let liveContract = null;
  let inputCutoff = null;
  let predictionsCompletedAt = null;
  let outcomesCompletedAt = null;

  const status = {
    schemaVersion: 'v3.10-forward-operations-status-v1',
    tradeDate,
    state: 'OBSERVING',
    observerStartedAt: startedAt.toISOString(),
    frozenSpecSha256: artifactHashes.specHash,
    frozenModelsSha256: artifactHashes.modelsHash,
    predictions: predictionRecords.length,
    outcomes: outcomeRecords.length,
    accepted: false,
    attemptStatus: null,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  writeJsonAtomic(statusPath, status);

  const consume = (line) => {
    if (!line) return;
    sourceAudit.observedLines += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      sourceAudit.invalidLines += 1;
      return;
    }
    const { recordHash, ...body } = record;
    const priorHash = previousObservedHash ?? body.previousHash;
    if (body.previousHash !== priorHash || recordHash !== liveRecordHash(priorHash, body)) {
      sourceAudit.hashFailures += 1;
    }
    previousObservedHash = recordHash || previousObservedHash;
    sourceAudit.sequenceGaps += Number(record.sequenceGap) || 0;
    if (record.duplicate) sourceAudit.duplicates += 1;
    const hasClockSkew = Math.abs(Number(record.clockSkewMs) || 0) > 5_000;
    if (hasClockSkew) sourceAudit.allClockSkewEvents += 1;
    if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) {
      sourceAudit.executionBoundaryErrors += 1;
    }
    if (isEligibleTxTick(record, tradeDate)) {
      if (hasClockSkew) sourceAudit.txTargetWindowClockSkewEvents += 1;
      ticks.push(record);
      const tickMinute = tickMinuteOfDay(record);
      sourceAudit.firstTxTickMinute ??= tickMinute;
      sourceAudit.lastTxTickMinute = tickMinute;
      liveContract ||= record.payload.code;
      if (Number(String(record.payload.time).slice(0, 2)) < 9) {
        inputCutoff = record.exchangeTimestamp;
      }
    }
  };

  const readAppended = () => {
    if (!fs.existsSync(ledgerPath)) return;
    const size = fs.statSync(ledgerPath).size;
    if (size <= position) return;
    const descriptor = fs.openSync(ledgerPath, 'r');
    try {
      while (position < size) {
        const length = Math.min(1024 * 1024, size - position);
        const buffer = Buffer.allocUnsafe(length);
        const count = fs.readSync(descriptor, buffer, 0, length, position);
        if (count <= 0) break;
        position += count;
        const text = pending + buffer.subarray(0, count).toString('utf8');
        const lines = text.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) consume(line);
      }
    } finally {
      fs.closeSync(descriptor);
    }
  };

  while (taipeiMinutes() < stopMinutes) {
    readAppended();
    const nowMinutes = taipeiMinutes();
    const bars = aggregateForwardBars(ticks);
    if (!predictionRecords.length && nowMinutes >= 9 * 60) {
      const openingBars = bars.filter((bar) => bar.barIndex < 3);
      if (nowMinutes > predictionDeadlineMinutes) {
        recordRejection(tradeDate, 'prediction_deadline_missed', {
          observedOpeningBars: openingBars.length,
          sourceAudit,
        });
        status.state = 'REJECTED';
        status.attemptStatus = classifyForwardAttempt({
          reason: 'prediction_deadline_missed',
          details: { observedOpeningBars: openingBars.length, sourceAudit },
        });
        status.rejectionReason = 'prediction_deadline_missed';
        writeJsonAtomic(statusPath, status);
        return;
      }
      if (openingBars.length === 3 && openingBars.every((bar, index) => bar.barIndex === index)) {
        if (!(sourceAudit.firstTxTickMinute < 8 * 60 + 46)
          || !(sourceAudit.lastTxTickMinute >= 8 * 60 + 59.5)) {
          recordRejection(tradeDate, 'opening_window_coverage_failed', {
            sourceAudit,
          });
          status.state = 'REJECTED';
          status.attemptStatus = classifyForwardAttempt({
            reason: 'opening_window_coverage_failed',
            details: { sourceAudit },
          });
          status.rejectionReason = 'opening_window_coverage_failed';
          writeJsonAtomic(statusPath, status);
          return;
        }
        const health = await bridgeHealth();
        if (!healthGate(health)) {
          recordRejection(tradeDate, 'prediction_operational_health_failed', { health });
          status.state = 'REJECTED';
          status.attemptStatus = classifyForwardAttempt({
            reason: 'prediction_operational_health_failed',
            details: { health },
          });
          status.rejectionReason = 'prediction_operational_health_failed';
          writeJsonAtomic(statusPath, status);
          return;
        }
        const currentRegistry = readForwardRegistry(registryPath);
        const features = buildForwardFeatureRow({
          tradeDate,
          liveContract,
          openingBars,
          historicalDays: loadHistoricalDays(tradeDate),
          rawFactors: loadRawFactors(tradeDate, new Date()),
          rankHistory: loadRankHistory(currentRegistry),
        });
        const predictions = predictFrozenModels(models, features);
        predictionRecords = appendPredictions({
          tradeDate,
          features,
          predictions,
          artifactHashes,
          sourceEvidence: {
            ledgerFile: path.basename(ledgerPath),
            observerStartedAt: startedAt.toISOString(),
            sourceAuditAtPrediction: { ...sourceAudit },
          },
          health,
          inputCutoff,
        });
        predictionsCompletedAt = new Date().toISOString();
        status.predictions = predictionRecords.length;
        status.predictionsCompletedAt = predictionsCompletedAt;
        writeJsonAtomic(statusPath, status);
      }
    }
    if (predictionRecords.length === 12 && !outcomeRecords.length && nowMinutes >= 10 * 60) {
      const firstFifteenBars = bars.filter((bar) => bar.barIndex < 15);
      if (firstFifteenBars.length === 15
        && firstFifteenBars.every((bar, index) => bar.barIndex === index)) {
        if (!(sourceAudit.lastTxTickMinute >= 9 * 60 + 59.5)) {
          recordRejection(tradeDate, 'outcome_window_coverage_failed', {
            sourceAudit,
          });
          status.state = 'REJECTED';
          status.attemptStatus = classifyForwardAttempt({
            reason: 'outcome_window_coverage_failed',
            details: { sourceAudit },
          });
          status.rejectionReason = 'outcome_window_coverage_failed';
          writeJsonAtomic(statusPath, status);
          return;
        }
        const health = await bridgeHealth();
        if (!healthGate(health)) {
          recordRejection(tradeDate, 'outcome_operational_health_failed', { health });
          status.state = 'REJECTED';
          status.attemptStatus = classifyForwardAttempt({
            reason: 'outcome_operational_health_failed',
            details: { health },
          });
          status.rejectionReason = 'outcome_operational_health_failed';
          writeJsonAtomic(statusPath, status);
          return;
        }
        const severities = calculateForwardSeverities(firstFifteenBars);
        const outcomes = resolveFrozenOutcomes(models, severities);
        outcomeRecords = appendOutcomes({
          tradeDate,
          outcomes,
          predictions: predictionRecords,
          severities,
          health,
        });
        outcomesCompletedAt = new Date().toISOString();
        status.outcomes = outcomeRecords.length;
        status.outcomesCompletedAt = outcomesCompletedAt;
        writeJsonAtomic(statusPath, status);
      }
    }
    if (nowMinutes >= 13 * 60 + 47) {
      const health = await bridgeHealth();
      registry = readForwardRegistry(registryPath);
      const registryAudit = auditForwardRegistry(registry);
      const sourceOk = sourceAudit.invalidLines === 0
        && sourceAudit.hashFailures === 0
        && sourceAudit.sequenceGaps === 0
        && sourceAudit.duplicates === 0
        && sourceAudit.txTargetWindowClockSkewEvents === 0
        && sourceAudit.executionBoundaryErrors === 0;
      const complete = predictionRecords.length === 12 && outcomeRecords.length === 12;
      if (!sourceOk || !registryAudit.ok || !healthGate(health) || !complete) {
        recordRejection(tradeDate, 'final_engineering_gate_failed', {
          sourceAudit,
          registryAudit,
          health,
          predictions: predictionRecords.length,
          outcomes: outcomeRecords.length,
        });
        status.state = 'REJECTED';
        status.attemptStatus = classifyForwardAttempt({
          reason: 'final_engineering_gate_failed',
          details: {
            sourceAudit,
            registryAudit,
            health,
            predictions: predictionRecords.length,
            outcomes: outcomeRecords.length,
          },
        });
        status.rejectionReason = 'final_engineering_gate_failed';
        status.sourceAudit = sourceAudit;
        status.registryAudit = registryAudit;
        writeJsonAtomic(statusPath, status);
        return;
      }
      const accepted = appendForwardRegistryRecord(registryPath, {
        eventType: 'forward_day_accepted',
        idempotencyKey: `forward_day_accepted:${tradeDate}`,
        tradeDate,
        recordedAt: new Date().toISOString(),
        predictionsCompletedAt,
        outcomesCompletedAt,
        predictionCount: predictionRecords.length,
        outcomeCount: outcomeRecords.length,
        attemptStatus: FORWARD_ATTEMPT_STATUS.ACCEPTED,
        sourceAudit,
        registryAudit,
        operationalHealth: health,
        formalModelWeight: 0,
        promotionAuthorized: false,
      });
      status.state = 'PASS';
      status.accepted = true;
      status.attemptStatus = FORWARD_ATTEMPT_STATUS.ACCEPTED;
      status.acceptanceRecordHash = accepted.record.recordHash;
      status.sourceAudit = sourceAudit;
      status.registryAudit = accepted.audit;
      writeJsonAtomic(statusPath, status);
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    await sleep(pollMs);
  }
  recordRejection(tradeDate, 'observer_timeout', {
    predictions: predictionRecords.length,
    outcomes: outcomeRecords.length,
    sourceAudit,
  });
  status.state = 'REJECTED';
  status.attemptStatus = classifyForwardAttempt({
    reason: 'observer_timeout',
    details: {
      predictions: predictionRecords.length,
      outcomes: outcomeRecords.length,
      sourceAudit,
    },
  });
  status.rejectionReason = 'observer_timeout';
  writeJsonAtomic(statusPath, status);
}

const tradeDate = arg('trade-date') || taipeiTradeDate();
let lockHandle;
try {
  lockHandle = acquireLock(tradeDate);
  await observe();
} catch (error) {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      recordRejection(tradeDate, 'operations_exception', {
        errorType: error.name,
        errorMessage: String(error.message).slice(0, 300),
      });
    }
  } catch {
    // Never mask the original failure with a secondary logging failure.
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  try { fs.closeSync(lockHandle); } catch { /* best effort */ }
  try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
}
