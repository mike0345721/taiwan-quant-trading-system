import fs from 'node:fs';
import path from 'node:path';
import { cru34LiveCanonicalJson, cru34LiveHash } from './cru34-live-checkpoint.mjs';
import { projectCru34LiveBatch } from './cru34-live-projection-worker.mjs';

const VERSION = 'cru34-calendar-tail-drain-v1';
const SAFETY = { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false };
const MAX_TRANSITION_DAYS = 7;

export function cru34TaipeiDate(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('CRU34_CALENDAR_CLOCK_INVALID');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function pathsFor(date, dataRoot, projectionRoot) {
  return { ledgerPath: path.join(dataRoot, 'live-events', `${date}.ndjson`),
    checkpointPath: path.join(projectionRoot, `${date}.checkpoint.json`),
    snapshotPath: path.join(projectionRoot, 'latest.json') };
}
function metadata(file) {
  try { const stat = fs.statSync(file, { bigint: true });
    const size = Number(stat.size);
    if (!Number.isSafeInteger(size)) throw new Error('CRU34_CALENDAR_FILE_SIZE_UNSAFE');
    return { size, mtimeNs: stat.mtimeNs.toString(), ino: stat.ino.toString() }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function readState(file) {
  const stat = metadata(file);
  if (!stat) return null;
  if (stat.size > 4096) throw new Error('CRU34_CALENDAR_STATE_BUDGET');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { stateHash, ...body } = state;
  if (body.schemaVersion !== VERSION || stateHash !== cru34LiveHash(body) || !validDate(body.activeDate)
      || typeof body.activeFileObserved !== 'boolean'
      || Object.entries(SAFETY).some(([key, value]) => body[key] !== value)
      || (body.closed && (!validDate(body.closed.date) || body.closed.date >= body.activeDate
        || !Number.isSafeInteger(body.closed.size) || body.closed.size < 0
        || !/^\d+$/.test(body.closed.mtimeNs || '') || !/^\d+$/.test(body.closed.ino || '')))) {
    throw new Error('CRU34_CALENDAR_STATE_INVALID');
  }
  return body;
}
function saveState(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...body, ...SAFETY };
  const bytes = `${cru34LiveCanonicalJson({ ...next, stateHash: cru34LiveHash(next) })}\n`;
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const verified = readState(file);
  if (cru34LiveCanonicalJson(verified) !== cru34LiveCanonicalJson(next)) throw new Error('CRU34_CALENDAR_STATE_READBACK_MISMATCH');
  return verified;
}
function unavailable(reason, activeDate, extra = {}) {
  return { status: 'UNAVAILABLE', reason, checkpoint: null, snapshot: null,
    calendarRollover: { status: reason, activeDate, analyticalContinuity: 'SINGLE_LEDGER_ONLY', ...extra } };
}

// The existing singleton worker owns this small cursor. It never joins GENESIS
// chains, edits a market ledger, or retroactively publishes an older source.
export function projectCru34CalendarBatch({ dataRoot, projectionRoot,
  calendarNow = new Date(), projectBatch = projectCru34LiveBatch, ...workerOptions } = {}) {
  if (!dataRoot || !projectionRoot) throw new Error('CRU34_CALENDAR_ROOTS_REQUIRED');
  const today = cru34TaipeiDate(calendarNow);
  const stateFile = path.join(projectionRoot, 'calendar-cursor.json');
  let state = readState(stateFile);
  if (!state) {
    // Installing over an existing producer must not replay yesterday over an
    // already published current-file snapshot. Old gaps require separate audit.
    state = saveState(stateFile, { schemaVersion: VERSION, activeDate: today, closed: null,
      activeFileObserved: metadata(pathsFor(today, dataRoot, projectionRoot).ledgerPath) !== null,
      adoption: 'CURRENT_DATE_NO_RETROACTIVE_RECOVERY', ...SAFETY });
  }
  if (state.activeDate > today) return unavailable('CALENDAR_CLOCK_MOVED_BACKWARD', state.activeDate);
  if (state.closed) {
    const observed = metadata(pathsFor(state.closed.date, dataRoot, projectionRoot).ledgerPath);
    if (!observed || ['size', 'mtimeNs', 'ino'].some(key => observed[key] !== state.closed[key])) {
      return unavailable('CLOSED_LEDGER_CHANGED_RECONCILIATION_REQUIRED', state.activeDate);
    }
  }
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${state.activeDate}T00:00:00Z`)) / 86400000);
  if (days > MAX_TRANSITION_DAYS) return unavailable('CALENDAR_TRANSITION_BUDGET_EXCEEDED', state.activeDate);
  const paths = pathsFor(state.activeDate, dataRoot, projectionRoot);
  // An unexpected newer checkpoint/snapshot is never a reason to rewind the
  // public latest.json. This also protects crash/migration inconsistencies.
  if (days) {
    for (let day = 1; day <= days; day++) {
      const date = new Date(Date.parse(`${state.activeDate}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
      if (metadata(pathsFor(date, dataRoot, projectionRoot).checkpointPath)) {
        return unavailable('FORWARD_CHECKPOINT_CONFLICT_RECONCILIATION_REQUIRED', state.activeDate, { nextDate: date });
      }
    }
    const latestStat = metadata(paths.snapshotPath);
    if (latestStat) {
      if (latestStat.size > 4 * 1024 * 1024) throw new Error('CRU34_CALENDAR_SNAPSHOT_BUDGET');
      const { snapshotHash, ...snapshot } = JSON.parse(fs.readFileSync(paths.snapshotPath, 'utf8'));
      if (snapshotHash !== cru34LiveHash(snapshot)) throw new Error('CRU34_CALENDAR_SNAPSHOT_INVALID');
      const availableAt = new Date(snapshot.semanticPayload?.availableAt);
      if (!Number.isFinite(availableAt.getTime())) throw new Error('CRU34_CALENDAR_SNAPSHOT_TIME_INVALID');
      if (cru34TaipeiDate(availableAt) > state.activeDate) {
        return unavailable('FORWARD_SNAPSHOT_CONFLICT_RECONCILIATION_REQUIRED', state.activeDate);
      }
    }
  }
  const before = metadata(paths.ledgerPath);
  if (!before) {
    // A never-created holiday/weekend file has no checkpoint or projected data.
    // Advance only to an existing bounded candidate; never skip an existing file.
    if (state.activeFileObserved || metadata(paths.checkpointPath)) return unavailable('ACTIVE_LEDGER_MISSING', state.activeDate);
    for (let offset = 1; offset <= days; offset++) {
      const nextDate = new Date(Date.parse(`${state.activeDate}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
      if (!metadata(pathsFor(nextDate, dataRoot, projectionRoot).ledgerPath)) continue;
      saveState(stateFile, { ...state, activeDate: nextDate, activeFileObserved: true });
      return unavailable('CALENDAR_EMPTY_DATE_ADVANCED', state.activeDate, { nextDate });
    }
    return unavailable('CURRENT_LEDGER_MISSING', state.activeDate);
  }
  if (!state.activeFileObserved) state = saveState(stateFile, { ...state, activeFileObserved: true });
  const result = projectBatch({ ...workerOptions, ...paths });
  const progress = { status: days ? 'DRAINING_PREVIOUS_CALENDAR_FILE' : 'CURRENT_CALENDAR_FILE',
    activeDate: state.activeDate, analyticalContinuity: 'SINGLE_LEDGER_ONLY', adoption: state.adoption };
  if (!days) return { ...result, calendarRollover: progress };
  const after = metadata(paths.ledgerPath);
  const offset = result.checkpoint?.lastVerifiedEndByteOffset ?? 0;
  if (!after || offset > after.size) throw new Error('CRU34_CALENDAR_LEDGER_TRUNCATED');
  if (offset < after.size) {
    return { ...result, calendarRollover: { ...progress,
      status: result.status === 'NO_COMPLETE_SUFFIX' ? 'PREVIOUS_LEDGER_PARTIAL_TAIL_PENDING' : progress.status,
      remainingBytes: after.size - offset } };
  }
  // EOF is a physical byte boundary, not completeness of capture. A new file
  // witnesses writer rotation; unchanged old metadata is fenced on later polls.
  if (['size', 'mtimeNs', 'ino'].some(key => before[key] !== after[key])) {
    return { ...result, calendarRollover: { ...progress, status: 'PREVIOUS_LEDGER_CHANGED_DURING_DRAIN' } };
  }
  for (let day = 1; day <= days; day++) {
    const nextDate = new Date(Date.parse(`${state.activeDate}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
    if (!metadata(pathsFor(nextDate, dataRoot, projectionRoot).ledgerPath)) continue;
    if (metadata(pathsFor(nextDate, dataRoot, projectionRoot).checkpointPath)) {
      return unavailable('FORWARD_CHECKPOINT_CONFLICT_RECONCILIATION_REQUIRED', state.activeDate, { nextDate });
    }
    saveState(stateFile, { ...state, activeDate: nextDate, activeFileObserved: true, closed: { date: state.activeDate, ...after,
      checkpointHash: result.checkpoint?.checkpointHash ?? null,
      recordHash: result.checkpoint?.lastVerifiedRecordHash ?? null } });
    return { ...result, calendarRollover: { ...progress, status: 'CALENDAR_TAIL_DRAINED', nextDate,
      continuityResetReason: 'NEW_LEDGER_GENESIS_NOT_PROOF_OF_NEW_MARKET_SESSION' } };
  }
  return { ...result, calendarRollover: { ...progress, status: 'NEXT_CALENDAR_LEDGER_PENDING' } };
}
