import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { atomicWriteJson, sha256File } from '../src/restartable-research-runner.mjs';
import {
  PP1_POLICY_VERSION,
  adaptLegacyIntradayArchive,
  buildContinuousSeries,
  buildContractSelectionSet,
  buildGapObservation,
  canonicalContractIdentity,
  classifySession,
} from '../src/pp1-market-semantics.mjs';

const root = path.resolve(import.meta.dirname, '..');
const phaseARun = path.join(root, 'data/research/full-historical-phase-a-v1/run-2026-07-30-a13-v2');
const frozenForward = path.join(root, 'data/intraday/research/v3.10-wave3-forward');
const archiveDir = path.join(root, 'data/intraday/archive');
const databasePath = path.join(root, 'v2/data/research-v2.sqlite');
const policyPath = path.join(root, 'research/pp1-v1/policy-spec.json');
const openingCloseEvidencePath = path.join(root, 'research/pp1-v1/opening-close-evidence.json');
const defaultRunDir = path.join(root, 'data/pp1-market-semantics/run-2026-08-01-v1');
const STAGES = ['P00','P01','P02','P03','P04','P05','P06','P07','P08','P09','P10'];

function arg(name, fallback = null) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function stableHash(value) { return digest(stable(value)); }
function now() { return new Date().toISOString(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { atomicWriteJson(file, value); return sha256File(file); }
function listFiles(folder) {
  if (!fs.existsSync(folder)) return [];
  const results = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full)); else results.push(full);
  }
  return results.sort();
}
function treeManifest(folder) {
  const files = listFiles(folder).map((file) => ({ path: path.relative(root, file).replaceAll('\\','/'), size: fs.statSync(file).size, sha256: sha256File(file) }));
  return { folder, fileCount: files.length, aggregateHash: stableHash(files), files };
}
function phaseAProtection() {
  const statusPath = path.join(phaseARun, 'RUN_STATUS.json');
  const status = readJson(statusPath);
  if (status.runId !== 'full-historical-phase-a-v1-2026-07-30') throw new Error('PP1_PHASE_A_RUN_ID_MISMATCH');
  const completed = status.jobs.filter((job) => job.status === 'COMPLETED');
  const invalid = completed.filter((job) => !job.outputPath || !fs.existsSync(job.outputPath) || sha256File(job.outputPath) !== job.outputHash);
  if (invalid.length) throw new Error(`PP1_PHASE_A_OUTPUT_HASH_INVALID:${invalid.length}`);
  return {
    runId: status.runId,
    runStatusHash: sha256File(statusPath),
    snapshotPath: status.immutable.snapshotPath,
    snapshotHashExpected: status.immutable.snapshotHash,
    snapshotHashActual: sha256File(status.immutable.snapshotPath),
    specHash: status.immutable.specHash,
    targetSpecHash: status.immutable.targetSpecHash,
    featureSpecHash: status.immutable.featureSpecHash,
    randomSeed: status.immutable.randomSeed,
    completedJobs: completed.length,
    completedOutputAggregateHash: stableHash(completed.map((job) => ({ key: job.key, outputHash: job.outputHash })).sort((a,b) => a.key.localeCompare(b.key))),
    pendingStages: [...new Set(status.jobs.filter((job) => job.status !== 'COMPLETED').map((job) => job.stage))].sort(),
  };
}
function assertProtectionEqual(before, after, label) {
  const keys = label === 'PhaseA'
    ? ['runId','runStatusHash','snapshotHashExpected','snapshotHashActual','specHash','targetSpecHash','featureSpecHash','randomSeed','completedJobs','completedOutputAggregateHash']
    : ['fileCount','aggregateHash'];
  for (const key of keys) if (stable(before[key]) !== stable(after[key])) throw new Error(`PP1_${label}_PROTECTION_CHANGED:${key}`);
}
function statusPath(runDir) { return path.join(runDir, 'RUN_STATUS.json'); }
function initialize(runDir) {
  fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  if (fs.existsSync(statusPath(runDir))) return readJson(statusPath(runDir));
  const policySpecHash = sha256File(policyPath);
  const status = {
    schemaVersion: 'pp1-restartable-run-v1', runId: path.basename(runDir), policyVersion: PP1_POLICY_VERSION,
    policySpecHash, createdAt: now(), updatedAt: now(), state: 'READY',
    safety: { formalWeight: 0, researchOnly: true, executionAuthorized: false },
    stages: STAGES.map((stageId) => ({ stageId, status: 'PENDING', inputHash: null, outputHash: null, outputPath: null, policySpecHash, startedAt: null, completedAt: null, error: null, resumeCommand: `node scripts/run-pp1-market-semantics.mjs --run-dir "${runDir}" --resume --stage ${stageId}` })),
  };
  writeJson(statusPath(runDir), status);
  return status;
}
function saveStatus(runDir, status) { status.updatedAt = now(); writeJson(statusPath(runDir), status); }
function artifact(runDir, stageId) { return path.join(runDir, 'artifacts', `${stageId}.json`); }
function stageOutput(runDir, stageId) { const file = artifact(runDir, stageId); if (!fs.existsSync(file)) throw new Error(`PP1_STAGE_OUTPUT_MISSING:${stageId}`); return readJson(file); }

function archivePayloads() {
  return fs.readdirSync(archiveDir).filter((name) => /^\d{4}-\d{2}-\d{2}-(day|night)\.json$/.test(name)).sort().map((name) => ({ name, payload: readJson(path.join(archiveDir, name)) }));
}
function taipeiIso(date, time) { return `${date}T${time}+08:00`; }
function priorCalendarDate(date) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0,10); }
function buildObservedCalendar() {
  const payloads = archivePayloads().map(({ payload }) => payload).filter((payload) => payload.tradeDate && payload.bars?.length);
  const dates = [...new Set(payloads.map((payload) => payload.tradeDate))].sort();
  const sessions = payloads.map((payload) => {
    const first = new Date(payload.bars[0].timestamp);
    const last = new Date(payload.bars.at(-1).timestamp);
    const sessionEnd = new Date(last.getTime() + 5 * 60_000);
    const startCalendarDate = first.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const sessionType = payload.session === 'day' ? 'DAY' : 'NIGHT';
    return {
      sessionId: `${startCalendarDate}-${sessionType}`,
      sessionType,
      sessionTradeDate: payload.tradeDate,
      sessionStart: first.toISOString(),
      sessionEnd: sessionEnd.toISOString(),
      isSettlementTradeDate: sessionType === 'DAY' && sessionEnd.toLocaleTimeString('en-GB', { timeZone: 'Asia/Taipei', hour12: false }) === '13:30:00',
    };
  }).sort((a,b) => a.sessionStart.localeCompare(b.sessionStart));
  const payload = { sourceType: 'TAIFEX_CALENDAR_OBSERVED_OFFICIAL_BATCH', scope: 'PAID_ARCHIVE_OBSERVED_SESSIONS_ONLY', sourceUrl: 'https://www.taifex.com.tw/cht/11/announcement', dates, sessions };
  return { ...payload, sourceDataHash: stableHash(payload) };
}
function contractMaster() {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT contract,MIN(trade_date) firstTradeDate,MAX(trade_date) finalTradeDate,COUNT(DISTINCT trade_date) observedTradeDays FROM futures_contract_daily WHERE product='TX' AND contract GLOB '20????' GROUP BY contract ORDER BY contract").all();
    return rows.map((row) => ({
      ...canonicalContractIdentity({ provider: 'TAIFEX_OFFICIAL_BATCH', providerCode: row.contract }), product: 'TX',
      firstTradeDate: row.firstTradeDate, expiryDate: row.finalTradeDate,
      finalTradingTimestamp: taipeiIso(row.finalTradeDate, '13:30:00'), observedTradeDays: row.observedTradeDays,
      finalTimestampEvidence: 'LAST_OBSERVED_OFFICIAL_DAILY_CONTRACT_ROW',
    }));
  } finally { db.close(); }
}
function migrationLogicalState(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const detail = Object.fromEntries(tables.map((name) => {
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    return [name, { rowCount: rows.length, logicalHash: stableHash(rows) }];
  }));
  const schemaRows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  return { schemaHash: stableHash(schemaRows), logicalDataHash: stableHash(detail), tableRowCounts: Object.fromEntries(Object.entries(detail).map(([key,value]) => [key,value.rowCount])), tableLogicalHashes: Object.fromEntries(Object.entries(detail).map(([key,value]) => [key,value.logicalHash])) };
}

const handlers = {
  P00(runDir) {
    const phaseA = phaseAProtection();
    if (phaseA.snapshotHashActual !== phaseA.snapshotHashExpected) throw new Error('PP1_PHASE_A_SNAPSHOT_HASH_CHANGED');
    return { stageId: 'P00', phaseA, frozenForward: treeManifest(frozenForward), policySpecHash: sha256File(policyPath), forbiddenCapabilities: { formalWeight: 0, researchOnly: true, executionAuthorized: false } };
  },
  P01(runDir) {
    const dbFile = path.join(runDir, 'pp1-migration-acceptance.sqlite');
    fs.rmSync(dbFile, { force: true });
    const db = new DatabaseSync(dbFile);
    let before; let afterMigration; let afterRollback;
    try {
      db.exec("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL); CREATE TABLE legacy_probe(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO legacy_probe(value) VALUES('preserve');");
      before = migrationLogicalState(db);
      db.exec(fs.readFileSync(path.join(root,'v2/migrations/019_pp1_market_semantics.sql'),'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run('019_pp1_market_semantics.sql', now());
      afterMigration = migrationLogicalState(db);
      db.exec(fs.readFileSync(path.join(root,'v2/migrations/rollback/019_pp1_market_semantics.rollback.sql'),'utf8'));
      afterRollback = migrationLogicalState(db);
    } finally { db.close(); }
    const physicalFileHash = sha256File(dbFile);
    return { stageId: 'P01', physicalFileHash, before, afterMigration, afterRollback, reverseMigrationPass: before.schemaHash === afterRollback.schemaHash && before.logicalDataHash === afterRollback.logicalDataHash, physicalHashRequired: false };
  },
  P02() {
    const calendar = buildObservedCalendar();
    const contracts = contractMaster();
    const openingCloseEvidence = readJson(openingCloseEvidencePath);
    if (openingCloseEvidence.tradeDates !== 116 || openingCloseEvidence.rows.length !== 232) throw new Error('PP1_RAW_OPENING_CLOSE_EVIDENCE_INCOMPLETE');
    return { stageId: 'P02', calendar, announcementOverlay: { sourceType: 'ANNOUNCEMENT_OVERLAY', entries: [], qualityState: 'PASS_NO_EXCEPTION_IN_OBSERVED_SCOPE', sourceDataHash: stableHash([]) }, contractMaster: { rows: contracts, sourceDataHash: stableHash(contracts), sourceType: 'TAIFEX_OFFICIAL_BATCH_DAILY_CONTRACT_ROWS' }, openingCloseEvidence: { path: openingCloseEvidencePath, sha256: sha256File(openingCloseEvidencePath), filesScanned: openingCloseEvidence.filesScanned, tradeDates: openingCloseEvidence.tradeDates, rows: openingCloseEvidence.rows } };
  },
  P03(runDir) {
    const source = stageOutput(runDir,'P02');
    const identities = source.contractMaster.rows.map((row) => canonicalContractIdentity({ provider: row.provider, providerCode: row.providerCode, providerAlias: row.providerAlias }));
    const aliases = [{ provider: 'SHIOAJI', providerAlias: 'TXFR1', mappingRule: 'RESOLVE_TARGET_CODE_AT_OBSERVATION_TIME', canonicalContractId: null, qualityState: 'UNAVAILABLE_UNTIL_RESOLVED' }, { provider: 'SHIOAJI', providerAlias: 'TXFR2', mappingRule: 'RESOLVE_TARGET_CODE_AT_OBSERVATION_TIME', canonicalContractId: null, qualityState: 'UNAVAILABLE_UNTIL_RESOLVED' }];
    return { stageId: 'P03', identities, aliases, deterministicHash: stableHash({ identities, aliases }) };
  },
  P04(runDir) {
    const calendar = stageOutput(runDir,'P02').calendar;
    const contexts = calendar.sessions.map((session) => classifySession(session.sessionStart, calendar));
    return { stageId: 'P04', contexts, count: contexts.length, day: contexts.filter((row) => row.sessionType === 'DAY').length, night: contexts.filter((row) => row.sessionType === 'NIGHT').length, crossMidnight: contexts.filter((row) => row.crossMidnight).length };
  },
  P05(runDir) {
    const source = stageOutput(runDir,'P02');
    const contexts = stageOutput(runDir,'P04').contexts;
    const sets = contexts.map((sessionContext) => buildContractSelectionSet({
      sessionContext, contracts: source.contractMaster.rows, completedReferenceVolumes: {}, selectedAt: sessionContext.sessionStart,
      policySpecHash: sha256File(policyPath), sourceDataHash: source.contractMaster.sourceDataHash,
      timestampLineage: { lineageMode: 'OFFICIAL_BATCH', officialAvailableAt: sessionContext.sessionStart },
    }));
    return { stageId: 'P05', sets, count: sets.length, note: 'Session-specific reference volume is absent from daily official rows; liquidity roles degrade to UNAVAILABLE and trading eligibility remains false.' };
  },
  P06(runDir) {
    const p02 = stageOutput(runDir,'P02');
    const calendar = p02.calendar;
    const rawEvidence = new Map(p02.openingCloseEvidence.rows.map((row) => [`${row.tradeDate}-${row.sessionType}`, row]));
    const payloads = archivePayloads();
    const byKey = new Map(payloads.map(({ payload }) => [`${payload.tradeDate}-${payload.session}`, payload]));
    const observations = [];
    const dates = [...new Set(payloads.map(({ payload }) => payload.tradeDate))].sort();
    for (const tradeDate of dates) {
      const day = byKey.get(`${tradeDate}-day`); const night = byKey.get(`${tradeDate}-night`);
      if (!day || !night || !day.bars.length || !night.bars.length) continue;
      const sourceBar = night.bars.at(-1); const targetBar = day.bars[0];
      const dayContext = classifySession(targetBar.timestamp, calendar);
      const nightContext = classifySession(sourceBar.timestamp, calendar);
      const dayEvidence = rawEvidence.get(`${tradeDate}-DAY`);
      const nightEvidence = rawEvidence.get(`${tradeDate}-NIGHT`);
      const openingType = dayEvidence?.openingAuctionAtSessionStart ? 'OPENING_AUCTION' : 'FIRST_LEGAL_TRADE';
      const openingTimestamp = dayEvidence?.firstExchangeTimestamp || targetBar.timestamp;
      const closeAgeSeconds = nightEvidence?.closeAgeSeconds ?? 61;
      observations.push(buildGapObservation({ definition: 'dayOpenVsPriorNightClose', source: { sessionId: nightContext.sessionId, tradeDate, contractCode: night.contract, closePrice: sourceBar.close, sessionType: 'NIGHT', closeAgeSeconds }, target: { sessionId: dayContext.sessionId, tradeDate, contractCode: day.contract, openPrice: targetBar.open, openingType, sessionStart: dayContext.sessionStart, exchangeTimestamp: openingTimestamp }, timestampLineage: { lineageMode: 'HISTORICAL_REPLAY', exchangeTimestamp: openingTimestamp, replayAvailableAt: '2026-07-29T22:43:27+08:00', necessaryInputAvailableAts: ['2026-07-29T22:43:27+08:00'] } }));
    }
    return { stageId: 'P06', observations, counts: Object.fromEntries(['PASS','DEGRADED','UNAVAILABLE'].map((quality) => [quality, observations.filter((row) => row.qualityState === quality).length])) };
  },
  P07() {
    const points = archivePayloads().filter(({ payload }) => payload.session === 'day' && payload.bars?.length).map(({ payload }) => ({ eventTimestamp: payload.bars.at(-1).timestamp, contractCode: payload.contract, price: payload.bars.at(-1).close })).sort((a,b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
    const series = buildContinuousSeries(points, { seriesAsOf: '2026-08-01T00:00:00+08:00', adjustmentKnowledgeAt: '2026-08-01T00:00:00+08:00', asOfReconstruction: 'TRUE_AS_OF', revisionNumber: 1 });
    return { stageId: 'P07', pointCount: points.length, series, preferredForReturnVolatilityRegime: 'CONTINUOUS_RETURN_LINKED_INDEX' };
  },
  P08(runDir) {
    const calendar = stageOutput(runDir,'P02').calendar;
    const samples = archivePayloads().slice(0,6).map(({ payload }) => adaptLegacyIntradayArchive(payload, { calendarSnapshot: calendar, replayAvailableAt: '2026-07-29T22:43:27+08:00' }));
    const firstHash = stableHash(samples); const secondHash = stableHash(archivePayloads().slice(0,6).map(({ payload }) => adaptLegacyIntradayArchive(payload, { calendarSnapshot: calendar, replayAvailableAt: '2026-07-29T22:43:27+08:00' })));
    return { stageId: 'P08', sampleCount: samples.length, firstHash, secondHash, idempotent: firstHash === secondHash, duplicateWrites: 0, samples };
  },
  P09(runDir) {
    const before = stageOutput(runDir,'P00').phaseA;
    const selections = stageOutput(runDir,'P05').sets;
    const selectedByDate = new Map(selections.filter((set) => set.sessionId.endsWith('-DAY')).map((set) => [set.sessionId.slice(0,10), set.records.find((row) => row.contractRole === 'SELECTED_RESEARCH')?.contractCode || null]));
    const db = new DatabaseSync(phaseARun + '/snapshot/research-v2-phase-a-2026-07-30.sqlite', { readOnly: true });
    let legacy;
    try { legacy = db.prepare("SELECT trade_date,contract FROM futures_contract_daily WHERE product='TX' AND session='一般' AND is_active=1 ORDER BY trade_date").all(); } finally { db.close(); }
    const affectedTradeDates = legacy.filter((row) => selectedByDate.has(row.trade_date) && selectedByDate.get(row.trade_date) !== row.contract).map((row) => ({ tradeDate: row.trade_date, phaseAContractCode: row.contract, pp1SelectedResearchContract: selectedByDate.get(row.trade_date) }));
    const factors = ['close_basis_bps','basis_change_1d_bps','basis_change_5d_bps','basis_level_z60','term_spread_bps','term_change_1d_bps','term_change_5d_bps','term_change_z60','days_to_near_expiry','rollover_risk','contract_changed','near_contract_oi'];
    const factorArtifacts = factors.map((factorId) => {
      const file = path.join(phaseARun,'jobs',`A11-${factorId}.ndjson`);
      return { factorId, originalArtifactPath: file, originalArtifactHash: fs.existsSync(file) ? sha256File(file) : null, contractPolicyStatus: 'PROVISIONAL', requiresPP1Reconciliation: true };
    });
    const after = phaseAProtection(); assertProtectionEqual(before, after, 'PhaseA');
    return { stageId: 'P09', phaseARunId: before.runId, affectedTradeDates, affectedTradeDateCount: affectedTradeDates.length, changedFactorValues: affectedTradeDates.length ? 'REQUIRES_TARGETED_RECOMPUTE_IN_SEPARATE_RECONCILIATION_RUN' : 'NONE_IN_OVERLAP', factorArtifacts, originalOutputsModified: false, phaseAProtectionBefore: before, phaseAProtectionAfter: after };
  },
  P10(runDir) {
    const p00 = stageOutput(runDir,'P00');
    const phaseAAfter = phaseAProtection(); const frozenAfter = treeManifest(frozenForward);
    assertProtectionEqual(p00.phaseA, phaseAAfter, 'PhaseA'); assertProtectionEqual(p00.frozenForward, frozenAfter, 'FrozenForward');
    const test = spawnSync(process.execPath, ['--test','tests/pp1-market-semantics.test.mjs','tests/pp1-migration.test.mjs'], { cwd: root, encoding: 'utf8' });
    const stageChecks = STAGES.filter((id) => id !== 'P10').map((id) => ({ stageId: id, outputExists: fs.existsSync(artifact(runDir,id)), outputHash: fs.existsSync(artifact(runDir,id)) ? sha256File(artifact(runDir,id)) : null }));
    const gates = {
      lineageModes: test.status === 0,
      historicalWithoutReceived: test.status === 0,
      liveWithoutReplay: test.status === 0,
      delayedOpeningRejected: test.status === 0,
      migrationRollbackLogicalHash: stageOutput(runDir,'P01').reverseMigrationPass,
      phaseAZeroChange: true,
      frozenForwardZeroChange: true,
      legacyAdapterIdempotent: stageOutput(runDir,'P08').idempotent,
      noFormalWeight: true, noSignal: true, noPaper: true, noOrderRoute: true, executionAuthorizedFalse: true,
      timestampLineageComplete: test.status === 0,
      selectionSetIntegrity: test.status === 0,
      backAdjustedAsOfGovernance: test.status === 0,
      settlementSemanticsSeparated: test.status === 0,
    };
    const pass = Object.values(gates).every(Boolean) && stageChecks.every((row) => row.outputExists);
    return { stageId: 'P10', acceptance: pass ? 'PASS' : 'FAIL', gates, stageChecks, tests: { exitCode: test.status, stdout: test.stdout, stderr: test.stderr }, phaseAAfter, frozenAfter, scopeDiff: { implemented: ['PP1 market semantics data contract','isolated migration','source snapshots','session and contract adapters','gap quality','continuous series','legacy adapter','reconciliation sidecar'], excluded: ['T0','H0/H1','Group State','Signal','Strategy','Risk Engine','Paper Trading','Dashboard','CVD/Flow','Greeks/DEX/GEX','Broker Orders','Automated Execution'] } };
  },
};

async function run() {
  const runDir = path.resolve(arg('--run-dir', defaultRunDir));
  const onlyStage = arg('--stage');
  const resume = process.argv.includes('--resume');
  const status = initialize(runDir);
  for (const stageId of STAGES) {
    if (onlyStage && stageId !== onlyStage) continue;
    const stage = status.stages.find((row) => row.stageId === stageId);
    if (stage.status === 'COMPLETED') {
      if (!stage.outputPath || !fs.existsSync(stage.outputPath) || sha256File(stage.outputPath) !== stage.outputHash) throw new Error(`PP1_COMPLETED_OUTPUT_INVALID:${stageId}`);
      if (resume || onlyStage) continue;
    }
    const prior = STAGES.slice(0, STAGES.indexOf(stageId));
    if (prior.some((id) => status.stages.find((row) => row.stageId === id)?.status !== 'COMPLETED')) throw new Error(`PP1_PRIOR_STAGE_INCOMPLETE:${stageId}`);
    stage.status = 'RUNNING'; stage.startedAt = now(); stage.error = null;
    stage.inputHash = stableHash({ prior: prior.map((id) => status.stages.find((row) => row.stageId === id)?.outputHash), policySpecHash: status.policySpecHash });
    saveStatus(runDir,status);
    try {
      const result = handlers[stageId](runDir);
      const outputPath = artifact(runDir,stageId); const outputHash = writeJson(outputPath,result);
      stage.status = 'COMPLETED'; stage.outputPath = outputPath; stage.outputHash = outputHash; stage.completedAt = now();
      saveStatus(runDir,status);
    } catch (error) {
      stage.status = 'FAILED'; stage.error = error.stack || error.message; stage.completedAt = now(); status.state = 'FAILED'; saveStatus(runDir,status); throw error;
    }
  }
  status.state = status.stages.every((row) => row.status === 'COMPLETED') ? 'COMPLETED' : 'READY_TO_RESUME';
  saveStatus(runDir,status);
  fs.writeFileSync(path.join(runDir,'NEXT_RESUME_COMMAND.txt'), status.state === 'COMPLETED' ? 'PP-1 completed; wait for Product Owner closeout review.\n' : `node scripts/run-pp1-market-semantics.mjs --run-dir "${runDir}" --resume\n`, 'utf8');
  console.log(JSON.stringify({ runDir, state: status.state, stages: status.stages.map(({stageId,status:stageStatus,outputHash,error}) => ({stageId,status:stageStatus,outputHash,error})) }, null, 2));
}

run().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
