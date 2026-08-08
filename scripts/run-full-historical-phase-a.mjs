import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import {
  atomicWriteFile,
  atomicWriteJson,
  createRunStatus,
  executeRun,
  initializeRun,
  loadRunStatus,
  preflightRun,
  rebuildReportsFromCompleted,
  sha256File,
  toCsv,
} from '../src/restartable-research-runner.mjs';
import {
  auditDuplicateKeys,
  buildCanonicalFeatureRows,
  factorDefinitions,
  stableDigest,
  summarizeCanonicalQuality,
} from '../src/phase-a-canonical.mjs';
import {
  analyzeUnivariate,
  buildDailyTargets,
  buildUnivariatePairs,
  univariateDigest,
} from '../src/phase-a-univariate.mjs';
import {
  negativeControlDigest,
  runLowCostNegativeControls,
} from '../src/phase-a-negative-controls.mjs';
import {
  PHASE_A_METHODS,
  buildEvidenceBlocks,
  buildPromotionBoard,
  buildRedundancyClusters,
  freezeF3Candidates,
  phaseARoundDigest,
  runGamChallenger,
  runRound3Controls,
  runStrongControls,
  runTransparentWalkForward,
  validateStagePayload,
} from '../src/phase-a-round2-3.mjs';

const root = path.resolve('.');
const defaultRunDir = path.join(root, 'data', 'research', 'full-historical-phase-a-v1', 'run-2026-07-30');
const sourceDbPath = path.join(root, 'v2', 'data', 'research-v2.sqlite');
const specPath = path.join(root, 'docs', 'research', 'FULL_HISTORICAL_RESEARCH_PHASE_A_V1.md');
const targetSpecPath = path.join(root, 'research', 'phase-a-v1', 'target-spec.json');
const featureSpecPath = path.join(root, 'research', 'phase-a-v1', 'feature-spec.json');
const randomSeed = 20260730;

function parseArgs(argv) {
  const parsed = {
    init: false,
    resume: false,
    rebuildReports: false,
    stage: null,
    runDir: defaultRunDir,
    injectFailureJobId: null,
    simulateCrashJobId: null,
    fullApproved: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--init') parsed.init = true;
    else if (arg === '--resume') parsed.resume = true;
    else if (arg === '--rebuild-reports') parsed.rebuildReports = true;
    else if (arg === '--full-approved') parsed.fullApproved = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--stage') parsed.stage = argv[++index];
    else if (arg === '--run-dir') parsed.runDir = path.resolve(argv[++index]);
    else if (arg === '--inject-failure-job') parsed.injectFailureJobId = argv[++index];
    else if (arg === '--simulate-crash-job') parsed.simulateCrashJobId = argv[++index];
    else throw new Error(`unknown_argument:${arg}`);
  }
  return parsed;
}

const phaseADag = Object.freeze({
  A20: ['A11', 'A12', 'A13'],
  A21: ['A13', 'A20'],
  A22: ['A21', 'TARGET_SPEC'],
  A23: ['A22'],
  A30: ['A20', 'A21', 'A22', 'A23'],
  A31: ['A30'],
  A32: ['A30', 'A31'],
  A33: ['A20', 'A21', 'A22', 'A23', 'A30', 'A31', 'A32'],
  A40: ['A00', 'A01', 'A02', 'A03', 'A04', 'A10', 'A11', 'A12', 'A13', 'A20', 'A21', 'A22', 'A23', 'A30', 'A31', 'A32', 'A33'],
});

const phaseARequiredStages = Object.freeze([
  'A00', 'A01', 'A02', 'A03', 'A04', 'A10', 'A11', 'A12', 'A13',
  'A20', 'A21', 'A22', 'A23', 'A30', 'A31', 'A32', 'A33', 'A40',
]);

function walkFiles(folder, result = []) {
  if (!fs.existsSync(folder)) return result;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, result);
    else result.push(absolute);
  }
  return result;
}

function codeManifest() {
  const extensions = new Set(['.mjs', '.js', '.py', '.json']);
  const candidates = [
    ...walkFiles(path.join(root, 'src')),
    ...walkFiles(path.join(root, 'scripts')),
    ...walkFiles(path.join(root, 'broker')),
    path.join(root, 'package.json'),
    specPath,
    targetSpecPath,
    featureSpecPath,
  ]
    .filter((file) => fs.existsSync(file) && extensions.has(path.extname(file).toLowerCase()))
    .sort();
  const rows = candidates.map((file) => ({
    path: path.relative(root, file).replaceAll('\\', '/'),
    sha256: sha256File(file),
  }));
  const serialized = `${rows.map((row) => `${row.path}\t${row.sha256}`).join('\n')}\n`;
  return {
    rows,
    hash: crypto.createHash('sha256').update(serialized).digest('hex'),
  };
}

function blockerPatchManifest() {
  const files = [
    path.join(root, 'src', 'restartable-research-runner.mjs'),
    path.join(root, 'src', 'phase-a-round2-3.mjs'),
    path.join(root, 'scripts', 'run-full-historical-phase-a.mjs'),
  ];
  const rows = files.map((file) => ({
    path: path.relative(root, file).replaceAll('\\', '/'),
    sha256: sha256File(file),
  }));
  return { rows, hash: phaseARoundDigest(rows) };
}

function gitMetadata() {
  try {
    const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { gitCommit: commit, gitStatus: 'available' };
  } catch {
    return {
      gitCommit: null,
      gitStatus: 'unavailable_empty_or_invalid_git_metadata',
    };
  }
}

const fixedStages = [
  ['A00', 'preflight', 'PREPARE', false],
  ['A01', 'snapshot', 'PREPARE', false],
  ['A02', 'inventory', 'PREPARE', false],
  ['A03', 'lineage', 'PREPARE', false],
  ['A04', 'smoke_atomic', 'PREPARE', false],
  ['A04', 'smoke_failed_resume', 'PREPARE', false],
  ['A04', 'smoke_crash_resume', 'PREPARE', false],
  ['A20', 'redundancy_cluster', 'ROUND_2', true],
  ['A21', 'evidence_blocks', 'ROUND_2', true],
  ['A22', 'transparent_walk_forward', 'ROUND_2', true],
  ['A23', 'round2_strong_controls', 'ROUND_2', true],
  ['A30', 'freeze_f3_candidates', 'ROUND_3', true],
  ['A31', 'gam_challenger', 'ROUND_3', true],
  ['A32', 'round3_2000_controls', 'ROUND_3', true],
  ['A33', 'promotion_and_phase_b_queue', 'ROUND_3', true],
  ['A40', 'aggregate_reports', 'AGGREGATE', false],
];

function initialJobs() {
  const fixed = fixedStages.map(([stage, jobId, round, heavy]) => ({
    stage,
    jobId,
    round,
    heavy,
    factorId: stage === 'A04' ? 'SMOKE_FACTOR' : null,
    targetId: stage === 'A04' ? 'SMOKE_TARGET' : null,
    foldId: stage === 'A04' ? 'SMOKE_FOLD' : null,
    modelId: stage === 'A04' ? 'SMOKE_MODEL' : null,
  }));
  const featureSpec = JSON.parse(fs.readFileSync(featureSpecPath, 'utf8'));
  const targetSpec = JSON.parse(fs.readFileSync(targetSpecPath, 'utf8'));
  const definitions = factorDefinitions(featureSpec);
  const a10 = definitions.map((definition) => ({
    stage: 'A10',
    jobId: `quality__${definition.factorId}`,
    round: 'ROUND_1',
    heavy: true,
    factorId: definition.factorId,
    targetId: 'DATA_QUALITY_AVAILABLE_AT',
    foldId: 'FULL_SNAPSHOT',
    modelId: 'RULE_AUDIT',
  }));
  a10.push({
    stage: 'A10',
    jobId: 'quality_available_at_summary',
    round: 'ROUND_1',
    heavy: true,
    factorId: '__SUMMARY__',
    targetId: 'DATA_QUALITY_AVAILABLE_AT',
    foldId: 'FULL_SNAPSHOT',
    modelId: 'RULE_AUDIT',
  });
  const a11 = definitions.map((definition) => ({
    stage: 'A11',
    jobId: `materialize__${definition.factorId}`,
    round: 'ROUND_1',
    heavy: true,
    factorId: definition.factorId,
    targetId: 'CANONICAL_FEATURE_VALUE',
    foldId: 'FULL_SNAPSHOT',
    modelId: 'DETERMINISTIC_TRANSFORM',
  }));
  a11.push({
    stage: 'A11',
    jobId: 'canonical_materialization_manifest',
    round: 'ROUND_1',
    heavy: true,
    factorId: '__MANIFEST__',
    targetId: 'CANONICAL_FEATURE_VALUE',
    foldId: 'FULL_SNAPSHOT',
    modelId: 'DETERMINISTIC_TRANSFORM',
  });
  const a12 = [];
  for (const definition of definitions) {
    for (const target of targetSpec.targets) {
      a12.push({
        stage: 'A12',
        jobId: `univariate__${definition.factorId}__${target.targetId}`,
        round: 'ROUND_1',
        heavy: true,
        factorId: definition.factorId,
        targetId: target.targetId,
        foldId: 'CHRONO_70_30_PURGE_1',
        modelId: 'DESCRIPTIVE_UNIVARIATE',
      });
    }
  }
  a12.push({
    stage: 'A12',
    jobId: 'round1_univariate_summary',
    round: 'ROUND_1',
    heavy: true,
    factorId: '__SUMMARY__',
    targetId: '__ALL_TARGETS__',
    foldId: 'CHRONO_70_30_PURGE_1',
    modelId: 'DESCRIPTIVE_UNIVARIATE',
  });
  const a13 = [];
  for (const definition of definitions) {
    for (const target of targetSpec.targets) {
      a13.push({
        stage: 'A13',
        jobId: `negative_controls__${definition.factorId}__${target.targetId}`,
        round: 'ROUND_1',
        heavy: true,
        factorId: definition.factorId,
        targetId: target.targetId,
        foldId: 'CHRONO_70_30_PURGE_1',
        modelId: 'LOW_COST_NEGATIVE_CONTROLS',
      });
    }
  }
  a13.push({
    stage: 'A13',
    jobId: 'round1_negative_controls_summary',
    round: 'ROUND_1',
    heavy: true,
    factorId: '__SUMMARY__',
    targetId: '__ALL_TARGETS__',
    foldId: 'CHRONO_70_30_PURGE_1',
    modelId: 'LOW_COST_NEGATIVE_CONTROLS',
  });
  const firstFutureIndex = fixed.findIndex((job) => job.stage === 'A20');
  return [
    ...fixed.slice(0, firstFutureIndex),
    ...a10,
    ...a11,
    ...a12,
    ...a13,
    ...fixed.slice(firstFutureIndex),
  ];
}

function initialize(runDir) {
  if (!fs.existsSync(sourceDbPath)) throw new Error(`source_db_missing:${sourceDbPath}`);
  const manifest = codeManifest();
  const git = gitMetadata();
  const status = createRunStatus({
    runId: 'full-historical-phase-a-v1-2026-07-30',
    command: `node scripts/run-full-historical-phase-a.mjs --run-dir "${runDir}" --resume`,
    immutable: {
      sourceDbPath,
      sourceDbHash: sha256File(sourceDbPath),
      snapshotPath: path.join(runDir, 'snapshot', 'research-v2-phase-a-2026-07-30.sqlite'),
      snapshotHash: null,
      specPath,
      specHash: sha256File(specPath),
      targetSpecPath,
      targetSpecHash: sha256File(targetSpecPath),
      featureSpecPath,
      featureSpecHash: sha256File(featureSpecPath),
      featureVersion: JSON.parse(fs.readFileSync(featureSpecPath, 'utf8')).featureVersion,
      targetVersion: JSON.parse(fs.readFileSync(targetSpecPath, 'utf8')).targetVersion,
      randomSeed,
      codeManifestHash: manifest.hash,
      codeManifest: manifest.rows,
      ...git,
      cutoffDate: '2026-07-30',
    },
    jobs: initialJobs(),
  });
  initializeRun(runDir, status);
}

function jsonOutput(runDir, job, payload) {
  const outputPath = path.join(runDir, 'jobs', `${job.stage}-${job.jobId}.json`);
  atomicWriteJson(outputPath, payload, { overwrite: false });
  return outputPath;
}

function tableDateColumn(columns) {
  return ['trade_date', 'observation_date', 'date'].find((name) => columns.includes(name)) || null;
}

const researchTables = [
  'market_daily', 'global_market_daily', 'macro_observations',
  'spot_institutional_daily', 'futures_positions_daily',
  'institutional_futures_detail_daily', 'futures_contract_daily',
  'futures_oi_daily', 'large_trader_futures_daily',
  'options_contract_daily', 'options_strike_daily', 'option_oi_changes',
  'volatility_relative_daily', 'basis_term_structure_daily',
  'option_volatility_daily', 'option_volatility_term_daily',
  'daily_features', 'research_input_registry_daily',
];

function rawInventory(snapshotPath) {
  const db = new DatabaseSync(snapshotPath, { readOnly: true });
  const rows = [];
  try {
    for (const table of researchTables) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) {
        rows.push({ table, column: '', exists: false, rows: 0 });
        continue;
      }
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      const dateColumn = tableDateColumn(columns.map((row) => row.name));
      const range = dateColumn
        ? db.prepare(`SELECT COUNT(*) rows, MIN(${dateColumn}) minDate, MAX(${dateColumn}) maxDate, COUNT(DISTINCT ${dateColumn}) distinctDates FROM ${table}`).get()
        : db.prepare(`SELECT COUNT(*) rows FROM ${table}`).get();
      for (const column of columns) {
        const nonNull = db.prepare(`SELECT COUNT(${column.name}) value FROM ${table}`).get().value;
        rows.push({
          table,
          column: column.name,
          type: column.type,
          primaryKey: column.pk,
          notNullDeclared: column.notnull,
          rows: Number(range.rows),
          nonNull: Number(nonNull),
          coveragePct: Number(range.rows) ? Number((Number(nonNull) / Number(range.rows) * 100).toFixed(4)) : 0,
          dateColumn,
          minDate: range.minDate || null,
          maxDate: range.maxDate || null,
          distinctDates: Number(range.distinctDates || 0),
          rawOrDerived: ['daily_features', 'volatility_relative_daily', 'basis_term_structure_daily', 'option_volatility_daily', 'option_volatility_term_daily', 'option_oi_changes'].includes(table)
            ? 'derived_or_research'
            : 'raw_or_normalized',
        });
      }
    }
  } finally {
    db.close();
  }
  return rows;
}

function expandLineage(featureSpec) {
  const rows = [];
  for (const group of featureSpec.groups) {
    for (const feature of group.baseFeatures || []) {
      for (const transform of feature.transforms || ['raw']) {
        rows.push({
          factorId: transform === 'raw' ? feature.factorId : `${feature.factorId}__${transform}`,
          baseFactorId: feature.factorId,
          factorGroup: group.factorGroup,
          sourceTable: group.sourceTable,
          sourceColumns: feature.columns || [],
          referenceColumns: feature.referenceColumns || [],
          symbol: feature.symbol || null,
          transform,
          featureVersion: featureSpec.featureVersion,
          availableAtRule: featureSpec.rules.availableAt,
          missingRule: featureSpec.rules.missing,
          standardization: featureSpec.rules.standardization,
          researchOnly: true,
          formalWeight: 0,
          executionAuthorized: false,
        });
      }
    }
    for (const source of group.additionalSources || []) {
      for (const factorId of source.factorIds || []) {
        rows.push({
          factorId,
          baseFactorId: factorId,
          factorGroup: group.factorGroup,
          sourceTable: source.table,
          sourceColumns: [factorId],
          referenceColumns: [],
          symbol: null,
          transform: 'existing_derived_or_raw',
          featureVersion: featureSpec.featureVersion,
          availableAtRule: featureSpec.rules.availableAt,
          missingRule: featureSpec.rules.missing,
          standardization: featureSpec.rules.standardization,
          researchOnly: true,
          formalWeight: 0,
          executionAuthorized: false,
        });
      }
    }
  }
  return rows;
}

function deterministicJsonOutput(outputPath, payload) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  if (fs.existsSync(outputPath)) {
    if (fs.readFileSync(outputPath, 'utf8') !== content) {
      throw new Error(`existing_output_content_mismatch:${outputPath}`);
    }
    return outputPath;
  }
  atomicWriteFile(outputPath, content, {
    overwrite: false,
    validate: (temporary) => JSON.parse(fs.readFileSync(temporary, 'utf8')),
  });
  return outputPath;
}

function deterministicTextOutput(outputPath, content) {
  if (fs.existsSync(outputPath)) {
    if (fs.readFileSync(outputPath, 'utf8') !== content) {
      throw new Error(`existing_output_content_mismatch:${outputPath}`);
    }
    return outputPath;
  }
  atomicWriteFile(outputPath, content, { overwrite: false });
  return outputPath;
}

function loadCanonicalRaw(snapshotPath) {
  const db = new DatabaseSync(snapshotPath, { readOnly: true });
  const read = (sql) => db.prepare(sql).all();
  try {
    return {
      marketRows: read('SELECT * FROM market_daily ORDER BY trade_date'),
      spotRows: read('SELECT * FROM spot_institutional_daily ORDER BY trade_date'),
      futuresRows: read('SELECT * FROM futures_positions_daily ORDER BY trade_date'),
      futuresOiRows: read('SELECT * FROM futures_oi_daily ORDER BY trade_date'),
      largeRows: read('SELECT * FROM large_trader_futures_daily ORDER BY trade_date, expiry_scope'),
      basisRows: read('SELECT * FROM basis_term_structure_daily ORDER BY trade_date'),
      optionsRows: read('SELECT * FROM options_contract_daily ORDER BY trade_date, expiry_date, contract'),
      optionVolRows: read('SELECT * FROM option_volatility_daily ORDER BY trade_date, expiry_date, contract'),
      optionTermRows: read('SELECT * FROM option_volatility_term_daily ORDER BY trade_date'),
      globalRows: read('SELECT * FROM global_market_daily ORDER BY symbol, trade_date'),
      macroRows: read('SELECT * FROM macro_observations ORDER BY series_key, observation_date'),
    };
  } finally {
    db.close();
  }
}

let canonicalCache = null;
let univariateCache = null;

function canonicalBundle(status) {
  const cacheKey = [
    status.immutable.snapshotHash,
    status.immutable.featureSpecHash,
  ].join(':');
  if (canonicalCache?.cacheKey === cacheKey) return canonicalCache;
  const featureSpec = JSON.parse(fs.readFileSync(status.immutable.featureSpecPath, 'utf8'));
  const raw = loadCanonicalRaw(status.immutable.snapshotPath);
  const definitions = factorDefinitions(featureSpec);
  const rows = buildCanonicalFeatureRows(raw, featureSpec);
  const quality = summarizeCanonicalQuality(rows, definitions);
  const duplicateAudits = auditDuplicateKeys(raw);
  canonicalCache = {
    cacheKey,
    featureSpec,
    raw,
    definitions,
    rows,
    quality,
    duplicateAudits,
    dataDigest: stableDigest(rows),
  };
  return canonicalCache;
}

function univariateBundle(status) {
  const cacheKey = [
    status.immutable.snapshotHash,
    status.immutable.featureSpecHash,
    status.immutable.targetSpecHash,
  ].join(':');
  if (univariateCache?.cacheKey === cacheKey) return univariateCache;
  const a11Manifest = status.jobs.find(
    (job) => job.stage === 'A11' && job.factorId === '__MANIFEST__',
  );
  if (a11Manifest?.status !== 'COMPLETED' || !a11Manifest.outputPath) {
    throw new Error('a11_manifest_must_complete_before_a12');
  }
  const featureDb = new DatabaseSync(a11Manifest.outputPath, { readOnly: true });
  let featureRows;
  try {
    featureRows = featureDb.prepare(`
      SELECT decision_trade_date AS decisionTradeDate,
             factor_id AS factorId,
             base_factor_id AS baseFactorId,
             factor_group AS factorGroup,
             value,
             quality_state AS qualityState
      FROM canonical_features
      ORDER BY decision_trade_date, factor_id
    `).all();
  } finally {
    featureDb.close();
  }
  const snapshot = new DatabaseSync(status.immutable.snapshotPath, { readOnly: true });
  let marketRows;
  let futuresContractRows;
  let futuresOiRows;
  try {
    marketRows = snapshot.prepare('SELECT * FROM market_daily ORDER BY trade_date').all();
    futuresContractRows = snapshot.prepare(`
      SELECT * FROM futures_contract_daily
      WHERE product='TX' AND session='一般'
      ORDER BY trade_date, contract
    `).all();
    futuresOiRows = snapshot.prepare('SELECT * FROM futures_oi_daily ORDER BY trade_date').all();
  } finally {
    snapshot.close();
  }
  const targetRows = buildDailyTargets({ marketRows, futuresContractRows, futuresOiRows });
  univariateCache = {
    cacheKey,
    featureRows,
    targetRows,
    featureDataDigest: stableDigest(featureRows),
    targetDataDigest: stableDigest(targetRows),
  };
  return univariateCache;
}

function completedPayloads(status, stage, predicate = () => true) {
  return status.jobs
    .filter((job) => job.stage === stage && job.status === 'COMPLETED' && predicate(job))
    .map((job) => JSON.parse(fs.readFileSync(job.outputPath, 'utf8')));
}

function stagePayload(status, stage) {
  const job = status.jobs.find((item) => item.stage === stage && item.status === 'COMPLETED');
  if (!job?.outputPath) throw new Error(`required_stage_output_missing:${stage}`);
  if (sha256File(job.outputPath) !== job.outputHash) throw new Error(`required_stage_output_hash_mismatch:${stage}`);
  return JSON.parse(fs.readFileSync(job.outputPath, 'utf8'));
}

function stageInputHash(status, dependencies) {
  const inputs = [];
  for (const dependency of dependencies) {
    if (dependency === 'TARGET_SPEC') {
      inputs.push({ dependency, hash: status.immutable.targetSpecHash });
      continue;
    }
    const jobs = status.jobs.filter((job) => job.stage === dependency);
    if (!jobs.length || jobs.some((job) => job.status !== 'COMPLETED' || !job.outputHash)) {
      throw new Error(`stage_input_incomplete:${dependency}`);
    }
    inputs.push({ dependency, hashes: jobs.map((job) => job.outputHash).sort() });
  }
  return phaseARoundDigest(inputs);
}

function thresholdsByTarget(status) {
  const output = {};
  for (const payload of completedPayloads(status, 'A12', (job) => job.factorId !== '__SUMMARY__')) {
    if (!output[payload.targetId]) output[payload.targetId] = payload.thresholdsFromDevelopmentOnly;
  }
  return output;
}

function contractSensitiveFactors() {
  const sidecar = path.join(root, 'data', 'pp1-market-semantics', 'run-2026-08-01-v3', 'artifacts', 'P09.json');
  if (!fs.existsSync(sidecar)) throw new Error(`pp1_contract_sidecar_missing:${sidecar}`);
  return JSON.parse(fs.readFileSync(sidecar, 'utf8')).factorArtifacts.map((item) => item.factorId).sort();
}

function roundPayload(stage, status, blockerPatchHash, body) {
  return {
    schemaVersion: `phase-a-${stage.toLowerCase()}-v1`,
    stage,
    runId: status.runId,
    snapshotHash: status.immutable.snapshotHash,
    specHash: status.immutable.specHash,
    targetSpecHash: status.immutable.targetSpecHash,
    featureSpecHash: status.immutable.featureSpecHash,
    featureVersion: status.immutable.featureVersion,
    targetVersion: status.immutable.targetVersion,
    randomSeed: status.immutable.randomSeed,
    blockerPatchHash,
    methods: PHASE_A_METHODS,
    ...body,
    researchOnly: true,
    formalWeight: 0,
    executionAuthorized: false,
  };
}

function writeRoundOutput(runDir, stage, payload) {
  const outputPath = path.join(runDir, 'jobs', `${stage}-${fixedStages.find((item) => item[0] === stage)[1]}.json`);
  return deterministicJsonOutput(outputPath, payload);
}

function writeCanonicalSqlite(outputPath, bundle, status) {
  const expectedDigest = bundle.dataDigest;
  if (fs.existsSync(outputPath)) {
    const existing = new DatabaseSync(outputPath, { readOnly: true });
    try {
      const digest = existing.prepare(
        "SELECT value FROM metadata WHERE key='data_digest'",
      ).get()?.value;
      const quick = existing.prepare('PRAGMA quick_check').all();
      if (digest !== expectedDigest || quick.length !== 1 || quick[0].quick_check !== 'ok') {
        throw new Error('existing_canonical_sqlite_failed_validation');
      }
      return outputPath;
    } finally {
      existing.close();
    }
  }

  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const db = new DatabaseSync(temporary);
  try {
    db.exec(`
      PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE canonical_features (
        decision_trade_date TEXT NOT NULL,
        decision_at TEXT NOT NULL,
        factor_id TEXT NOT NULL,
        base_factor_id TEXT NOT NULL,
        factor_group TEXT NOT NULL,
        transform TEXT NOT NULL,
        value REAL,
        source_trade_date TEXT,
        available_at TEXT,
        source_table TEXT NOT NULL,
        source_contract TEXT,
        quality_state TEXT NOT NULL,
        quality_reason TEXT,
        formula TEXT,
        transform_formula TEXT,
        feature_version TEXT NOT NULL,
        research_only INTEGER NOT NULL CHECK(research_only=1),
        formal_weight REAL NOT NULL CHECK(formal_weight=0),
        execution_authorized INTEGER NOT NULL CHECK(execution_authorized=0),
        PRIMARY KEY (decision_trade_date, factor_id)
      );
      CREATE INDEX idx_canonical_factor_date
      ON canonical_features(factor_id, decision_trade_date);
      CREATE INDEX idx_canonical_quality
      ON canonical_features(quality_state, decision_trade_date);
    `);
    const insertMeta = db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)');
    const metadata = {
      schema_version: 'phase-a-canonical-materialization-v1',
      snapshot_hash: status.immutable.snapshotHash,
      spec_hash: status.immutable.specHash,
      target_spec_hash: status.immutable.targetSpecHash,
      feature_spec_hash: status.immutable.featureSpecHash,
      feature_version: status.immutable.featureVersion,
      random_seed: String(status.immutable.randomSeed),
      data_digest: expectedDigest,
      row_count: String(bundle.rows.length),
      factor_count: String(bundle.definitions.length),
      decision_trade_date_count: String(new Set(bundle.rows.map((row) => row.decisionTradeDate)).size),
      research_only: 'true',
      formal_weight: '0',
      execution_authorized: 'false',
    };
    db.exec('BEGIN IMMEDIATE');
    for (const [key, value] of Object.entries(metadata)) insertMeta.run(key, value);
    const insert = db.prepare(`
      INSERT INTO canonical_features(
        decision_trade_date, decision_at, factor_id, base_factor_id,
        factor_group, transform, value, source_trade_date, available_at,
        source_table, source_contract, quality_state, quality_reason,
        formula, transform_formula, feature_version, research_only,
        formal_weight, execution_authorized
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0)
    `);
    for (const row of bundle.rows) {
      insert.run(
        row.decisionTradeDate,
        row.decisionAt,
        row.factorId,
        row.baseFactorId,
        row.factorGroup,
        row.transform,
        row.value,
        row.sourceTradeDate,
        row.availableAt,
        row.sourceTable,
        row.sourceContract,
        row.qualityState,
        row.qualityReason,
        row.formula,
        row.transformFormula,
        status.immutable.featureVersion,
      );
    }
    db.exec('COMMIT');
    const quick = db.prepare('PRAGMA quick_check').all();
    if (quick.length !== 1 || quick[0].quick_check !== 'ok') {
      throw new Error('canonical_sqlite_quick_check_failed');
    }
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }
  fs.renameSync(temporary, outputPath);
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${temporary}${suffix}`, { force: true });
  return outputPath;
}

const handlers = {
  A00: async ({ job, status, runDir }) => {
    const outputPath = jsonOutput(runDir, job, {
      stage: job.stage,
      jobId: job.jobId,
      checkedAt: new Date().toISOString(),
      sourceDbExists: fs.existsSync(status.immutable.sourceDbPath),
      sourceDbHash: status.immutable.sourceDbHash,
      gitCommit: status.immutable.gitCommit,
      gitStatus: status.immutable.gitStatus,
      codeManifestHash: status.immutable.codeManifestHash,
      specHash: status.immutable.specHash,
      targetSpecHash: status.immutable.targetSpecHash,
      featureSpecHash: status.immutable.featureSpecHash,
      researchOnly: true,
      formalWeight: 0,
      executionAuthorized: false,
    });
    return { outputPath, inputHash: status.immutable.sourceDbHash };
  },
  A01: async ({ job, status, runDir }) => {
    const destination = status.immutable.snapshotPath;
    if (fs.existsSync(destination)) {
      if (!status.immutable.snapshotHash || sha256File(destination) !== status.immutable.snapshotHash) {
        throw new Error('existing_snapshot_without_matching_frozen_hash');
      }
    } else {
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const source = new DatabaseSync(status.immutable.sourceDbPath, { readOnly: true });
      try {
        await backup(source, temporary);
      } finally {
        source.close();
      }
      const check = new DatabaseSync(temporary, { readOnly: true });
      try {
        const quick = check.prepare('PRAGMA quick_check').all();
        if (quick.length !== 1 || quick[0].quick_check !== 'ok') throw new Error('snapshot_quick_check_failed');
      } finally {
        check.close();
      }
      fs.renameSync(temporary, destination);
    }
    const snapshotHash = sha256File(destination);
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    let tables;
    try {
      tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    } finally {
      snapshot.close();
    }
    const outputPath = jsonOutput(runDir, job, {
      stage: job.stage,
      jobId: job.jobId,
      createdAt: new Date().toISOString(),
      sourceDbHash: status.immutable.sourceDbHash,
      snapshotPath: destination,
      snapshotHash,
      bytes: fs.statSync(destination).size,
      tables,
      quickCheck: 'ok',
    });
    return {
      outputPath,
      inputHash: status.immutable.sourceDbHash,
      contextPatch: { snapshotHash },
    };
  },
  A02: async ({ job, status, runDir }) => {
    if (!status.immutable.snapshotHash) throw new Error('snapshot_required_for_inventory');
    const rows = rawInventory(status.immutable.snapshotPath);
    const columns = [
      'table', 'column', 'type', 'primaryKey', 'notNullDeclared', 'rows',
      'nonNull', 'coveragePct', 'dateColumn', 'minDate', 'maxDate',
      'distinctDates', 'rawOrDerived',
    ];
    const outputPath = path.join(runDir, 'jobs', `${job.stage}-${job.jobId}.csv`);
    atomicWriteFile(outputPath, toCsv(rows, columns), { overwrite: false });
    return { outputPath, inputHash: status.immutable.snapshotHash };
  },
  A03: async ({ job, status, runDir }) => {
    const featureSpec = JSON.parse(fs.readFileSync(status.immutable.featureSpecPath, 'utf8'));
    const rows = expandLineage(featureSpec);
    const outputPath = path.join(runDir, 'jobs', `${job.stage}-${job.jobId}.json`);
    atomicWriteJson(outputPath, {
      schemaVersion: 'phase-a-feature-lineage-v1',
      generatedAt: new Date().toISOString(),
      featureVersion: featureSpec.featureVersion,
      featureSpecHash: status.immutable.featureSpecHash,
      factorCount: rows.length,
      factors: rows,
    }, { overwrite: false });
    return { outputPath, inputHash: status.immutable.featureSpecHash };
  },
  A04: async ({ job, status, runDir }) => {
    const payload = {
      stage: job.stage,
      jobId: job.jobId,
      factorId: job.factorId,
      targetId: job.targetId,
      foldId: job.foldId,
      modelId: job.modelId,
      attempt: job.attempts,
      completedAt: new Date().toISOString(),
      snapshotHash: status.immutable.snapshotHash,
      specHash: status.immutable.specHash,
      targetSpecHash: status.immutable.targetSpecHash,
      featureSpecHash: status.immutable.featureSpecHash,
      randomSeed: status.immutable.randomSeed,
      researchOnly: true,
      executionAuthorized: false,
    };
    const outputPath = jsonOutput(runDir, job, payload);
    return { outputPath, inputHash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  },
  A10: async ({ job, status, runDir }) => {
    if (!status.immutable.snapshotHash) throw new Error('snapshot_required_for_a10');
    const bundle = canonicalBundle(status);
    if (job.factorId === '__SUMMARY__') {
      const incomplete = status.jobs.filter((item) => (
        item.stage === 'A10'
        && item.factorId !== '__SUMMARY__'
        && item.status !== 'COMPLETED'
      ));
      if (incomplete.length) throw new Error(`a10_factor_jobs_incomplete:${incomplete.length}`);
      const availableAtViolations = bundle.rows.filter(
        (row) => row.qualityState === 'AVAILABLE_AT_VIOLATION',
      ).length;
      const duplicateKeyViolations = bundle.duplicateAudits.reduce(
        (sum, audit) => sum + audit.duplicateKeys,
        0,
      );
      const blocked = bundle.quality.filter((factor) => factor.qualityState === 'BLOCKED');
      const failed = bundle.quality.filter((factor) => factor.qualityState === 'FAIL');
      const payload = {
        schemaVersion: 'phase-a-a10-quality-summary-v1',
        stage: 'A10',
        snapshotHash: status.immutable.snapshotHash,
        featureSpecHash: status.immutable.featureSpecHash,
        featureVersion: status.immutable.featureVersion,
        factorCount: bundle.definitions.length,
        decisionTradeDateCount: new Set(bundle.rows.map((row) => row.decisionTradeDate)).size,
        canonicalRowCount: bundle.rows.length,
        dataDigest: bundle.dataDigest,
        duplicateAudits: bundle.duplicateAudits,
        duplicateKeyViolations,
        availableAtViolations,
        factorQualityCounts: {
          PASS: bundle.quality.filter((factor) => factor.qualityState === 'PASS').length,
          BLOCKED: blocked.length,
          FAIL: failed.length,
        },
        blockedFactors: blocked.map((factor) => ({
          factorId: factor.factorId,
          reason: factor.qualityReason,
        })),
        failedFactors: failed.map((factor) => ({
          factorId: factor.factorId,
          reason: factor.qualityReason,
        })),
        acceptance: duplicateKeyViolations === 0 && availableAtViolations === 0
          ? 'PASS_WITH_EXPLICIT_QUARANTINE'
          : 'FAIL',
        safeguards: status.safeguards,
      };
      const outputPath = deterministicJsonOutput(
        path.join(runDir, 'jobs', 'A10-quality_available_at_summary.json'),
        payload,
      );
      return { outputPath, inputHash: stableDigest(payload) };
    }
    const quality = bundle.quality.find((item) => item.factorId === job.factorId);
    if (!quality) throw new Error(`a10_factor_not_found:${job.factorId}`);
    const payload = {
      schemaVersion: 'phase-a-a10-factor-quality-v1',
      stage: 'A10',
      snapshotHash: status.immutable.snapshotHash,
      featureSpecHash: status.immutable.featureSpecHash,
      ...quality,
      researchOnly: true,
      formalWeight: 0,
      executionAuthorized: false,
    };
    const outputPath = deterministicJsonOutput(
      path.join(runDir, 'jobs', `A10-${job.factorId}.json`),
      payload,
    );
    return { outputPath, inputHash: stableDigest(payload) };
  },
  A11: async ({ job, status, runDir }) => {
    if (!status.immutable.snapshotHash) throw new Error('snapshot_required_for_a11');
    const bundle = canonicalBundle(status);
    const a10Summary = status.jobs.find(
      (item) => item.stage === 'A10' && item.factorId === '__SUMMARY__',
    );
    if (a10Summary?.status !== 'COMPLETED') throw new Error('a10_summary_must_complete_before_a11');
    if (job.factorId === '__MANIFEST__') {
      const incomplete = status.jobs.filter((item) => (
        item.stage === 'A11'
        && item.factorId !== '__MANIFEST__'
        && item.status !== 'COMPLETED'
      ));
      if (incomplete.length) throw new Error(`a11_factor_jobs_incomplete:${incomplete.length}`);
      const replayRows = buildCanonicalFeatureRows(bundle.raw, bundle.featureSpec);
      const replayDigest = stableDigest(replayRows);
      if (replayDigest !== bundle.dataDigest) throw new Error('canonical_replay_digest_mismatch');
      const outputPath = path.join(runDir, 'jobs', 'A11-canonical-features.sqlite');
      writeCanonicalSqlite(outputPath, bundle, status);
      return {
        outputPath,
        inputHash: stableDigest({
          snapshotHash: status.immutable.snapshotHash,
          featureSpecHash: status.immutable.featureSpecHash,
          dataDigest: bundle.dataDigest,
          replayDigest,
        }),
      };
    }
    const a10Factor = status.jobs.find(
      (item) => item.stage === 'A10' && item.factorId === job.factorId,
    );
    if (a10Factor?.status !== 'COMPLETED') {
      throw new Error(`a10_factor_must_complete_before_a11:${job.factorId}`);
    }
    const rows = bundle.rows.filter((row) => row.factorId === job.factorId);
    if (!rows.length) throw new Error(`a11_factor_rows_missing:${job.factorId}`);
    const content = `${rows.map((row) => JSON.stringify({
      ...row,
      featureVersion: status.immutable.featureVersion,
      researchOnly: true,
      formalWeight: 0,
      executionAuthorized: false,
    })).join('\n')}\n`;
    const outputPath = deterministicTextOutput(
      path.join(runDir, 'jobs', `A11-${job.factorId}.ndjson`),
      content,
    );
    return {
      outputPath,
      inputHash: stableDigest({
        snapshotHash: status.immutable.snapshotHash,
        featureSpecHash: status.immutable.featureSpecHash,
        factorId: job.factorId,
        rows,
      }),
    };
  },
  A12: async ({ job, status, runDir }) => {
    const bundle = univariateBundle(status);
    if (job.factorId === '__SUMMARY__') {
      const incomplete = status.jobs.filter((item) => (
        item.stage === 'A12'
        && item.factorId !== '__SUMMARY__'
        && item.status !== 'COMPLETED'
      ));
      if (incomplete.length) throw new Error(`a12_jobs_incomplete:${incomplete.length}`);
      const resultJobs = status.jobs.filter(
        (item) => item.stage === 'A12' && item.factorId !== '__SUMMARY__',
      );
      const results = resultJobs.map((item) => {
        if (!item.outputPath || !fs.existsSync(item.outputPath)) {
          throw new Error(`a12_result_missing:${item.key}`);
        }
        return JSON.parse(fs.readFileSync(item.outputPath, 'utf8'));
      });
      const statusCounts = results.reduce((counts, result) => {
        counts[result.evaluationStatus] = (counts[result.evaluationStatus] || 0) + 1;
        return counts;
      }, {});
      const byTarget = {};
      for (const result of results) {
        if (!byTarget[result.targetId]) {
          byTarget[result.targetId] = {
            total: 0,
            DESCRIPTIVE_COMPLETE: 0,
            INSUFFICIENT_DATA: 0,
          };
        }
        byTarget[result.targetId].total += 1;
        byTarget[result.targetId][result.evaluationStatus] += 1;
      }
      const payload = {
        schemaVersion: 'phase-a-a12-summary-v1',
        stage: 'A12',
        snapshotHash: status.immutable.snapshotHash,
        featureSpecHash: status.immutable.featureSpecHash,
        targetSpecHash: status.immutable.targetSpecHash,
        featureDataDigest: bundle.featureDataDigest,
        targetDataDigest: bundle.targetDataDigest,
        factorTargetJobCount: results.length,
        statusCounts,
        byTarget,
        promotionDecisionMade: false,
        pValuesCalculated: false,
        multipleComparisonDecisionMade: false,
        nextAllowedStage: 'A13_REQUIRES_OWNER_APPROVAL',
        researchOnly: true,
        formalWeight: 0,
        executionAuthorized: false,
      };
      const outputPath = deterministicJsonOutput(
        path.join(runDir, 'jobs', 'A12-round1_univariate_summary.json'),
        payload,
      );
      return { outputPath, inputHash: univariateDigest(payload) };
    }
    const result = analyzeUnivariate({
      factorId: job.factorId,
      targetId: job.targetId,
      featureRows: bundle.featureRows,
      targetRows: bundle.targetRows,
    });
    const payload = {
      ...result,
      snapshotHash: status.immutable.snapshotHash,
      featureSpecHash: status.immutable.featureSpecHash,
      targetSpecHash: status.immutable.targetSpecHash,
      featureDataDigest: bundle.featureDataDigest,
      targetDataDigest: bundle.targetDataDigest,
    };
    const outputPath = deterministicJsonOutput(
      path.join(runDir, 'jobs', `A12-${job.factorId}-${job.targetId}.json`),
      payload,
    );
    return { outputPath, inputHash: univariateDigest(payload) };
  },
  A13: async ({ job, status, runDir }) => {
    const a12Summary = status.jobs.find(
      (item) => item.stage === 'A12' && item.factorId === '__SUMMARY__',
    );
    if (a12Summary?.status !== 'COMPLETED') {
      throw new Error('a12_summary_must_complete_before_a13');
    }
    if (job.factorId === '__SUMMARY__') {
      const incomplete = status.jobs.filter((item) => (
        item.stage === 'A13'
        && item.factorId !== '__SUMMARY__'
        && item.status !== 'COMPLETED'
      ));
      if (incomplete.length) throw new Error(`a13_jobs_incomplete:${incomplete.length}`);
      const resultJobs = status.jobs.filter(
        (item) => item.stage === 'A13' && item.factorId !== '__SUMMARY__',
      );
      const results = resultJobs.map((item) => {
        if (!item.outputPath || !fs.existsSync(item.outputPath)) {
          throw new Error(`a13_result_missing:${item.key}`);
        }
        return JSON.parse(fs.readFileSync(item.outputPath, 'utf8'));
      });
      const statusCounts = results.reduce((counts, result) => {
        counts[result.evaluationStatus] = (counts[result.evaluationStatus] || 0) + 1;
        return counts;
      }, {});
      const byTarget = {};
      for (const result of results) {
        if (!byTarget[result.targetId]) {
          byTarget[result.targetId] = {
            total: 0,
            PROVISIONAL_ROUND2_PASS: 0,
            ROUND1_NEGATIVE_CONTROL_FAIL: 0,
            INSUFFICIENT_DATA: 0,
          };
        }
        byTarget[result.targetId].total += 1;
        byTarget[result.targetId][result.evaluationStatus] += 1;
      }
      const provisionalRound2Candidates = results
        .filter((result) => result.computeAllocationEligible)
        .map((result) => ({
          factorId: result.factorId,
          targetId: result.targetId,
          evaluationRows: result.evaluationRows,
          absoluteSpearman: result.observed?.absoluteSpearman ?? null,
          blockPermutationEmpiricalP: result.movingBlockPlacebo?.empiricalP ?? null,
          randomFeatureP95: result.randomFeatureCompetition?.statisticP95 ?? null,
          top5ContributionShare: result.concentrationDiagnostic?.top5ContributionShare ?? null,
        }))
        .sort((left, right) => (
          left.factorId.localeCompare(right.factorId)
          || left.targetId.localeCompare(right.targetId)
        ));
      const payload = {
        schemaVersion: 'phase-a-a13-summary-v1',
        stage: 'A13',
        snapshotHash: status.immutable.snapshotHash,
        featureSpecHash: status.immutable.featureSpecHash,
        targetSpecHash: status.immutable.targetSpecHash,
        randomSeed: status.immutable.randomSeed,
        factorTargetJobCount: results.length,
        statusCounts,
        byTarget,
        provisionalRound2CandidateCount: provisionalRound2Candidates.length,
        provisionalRound2Candidates,
        interpretation: 'COMPUTE_ALLOCATION_ONLY_NOT_FACTOR_VALIDATION',
        pValuesAreLowCostScreeningOnly: true,
        multipleComparisonDecisionMade: false,
        promotionDecisionMade: false,
        nextAllowedStage: 'A20_REQUIRES_PRODUCT_OWNER_APPROVAL',
        researchOnly: true,
        formalWeight: 0,
        executionAuthorized: false,
      };
      const outputPath = deterministicJsonOutput(
        path.join(runDir, 'jobs', 'A13-round1_negative_controls_summary.json'),
        payload,
      );
      return { outputPath, inputHash: negativeControlDigest(payload) };
    }

    const a12Job = status.jobs.find((item) => (
      item.stage === 'A12'
      && item.factorId === job.factorId
      && item.targetId === job.targetId
    ));
    if (a12Job?.status !== 'COMPLETED' || !a12Job.outputPath) {
      throw new Error(`a12_factor_target_must_complete_before_a13:${job.factorId}:${job.targetId}`);
    }
    const a12Result = JSON.parse(fs.readFileSync(a12Job.outputPath, 'utf8'));
    const bundle = univariateBundle(status);
    const pairs = buildUnivariatePairs({
      factorId: job.factorId,
      targetId: job.targetId,
      featureRows: bundle.featureRows,
      targetRows: bundle.targetRows,
    });
    const result = runLowCostNegativeControls({
      factorId: job.factorId,
      targetId: job.targetId,
      evaluationRows: pairs.evaluation,
      a12Result,
      globalSeed: status.immutable.randomSeed,
    });
    const payload = {
      ...result,
      fold: pairs.split,
      snapshotHash: status.immutable.snapshotHash,
      featureSpecHash: status.immutable.featureSpecHash,
      targetSpecHash: status.immutable.targetSpecHash,
      featureDataDigest: bundle.featureDataDigest,
      targetDataDigest: bundle.targetDataDigest,
      a12OutputHash: a12Job.outputHash,
    };
    const outputPath = deterministicJsonOutput(
      path.join(runDir, 'jobs', `A13-${job.factorId}-${job.targetId}.json`),
      payload,
    );
    return { outputPath, inputHash: negativeControlDigest(payload) };
  },
  A20: async ({ status, runDir }) => {
    const bundle = univariateBundle(status);
    const patch = blockerPatchManifest();
    const redundancy = buildRedundancyClusters(bundle.featureRows);
    const payload = roundPayload('A20', status, patch.hash, {
      inputHash: stageInputHash(status, phaseADag.A20),
      redundancy,
    });
    const outputPath = writeRoundOutput(runDir, 'A20', payload);
    return { outputPath, inputHash: payload.inputHash, contextPatch: { blockerPatchHash: patch.hash, blockerPatchManifest: patch.rows } };
  },
  A21: async ({ status, runDir }) => {
    const bundle = univariateBundle(status);
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a20 = stagePayload(status, 'A20');
    const a13Results = completedPayloads(status, 'A13', (job) => job.factorId !== '__SUMMARY__');
    const evidenceBlocks = buildEvidenceBlocks({ featureRows: bundle.featureRows, a13Results, redundancy: a20.redundancy });
    const payload = roundPayload('A21', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A21), evidenceBlocks });
    const outputPath = writeRoundOutput(runDir, 'A21', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A22: async ({ status, runDir }) => {
    const bundle = univariateBundle(status);
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a21 = stagePayload(status, 'A21');
    const targetSpec = JSON.parse(fs.readFileSync(status.immutable.targetSpecPath, 'utf8'));
    const walkForward = runTransparentWalkForward({
      featureRows: bundle.featureRows,
      targetRows: bundle.targetRows,
      targetSpec,
      evidenceBlocks: a21.evidenceBlocks,
      thresholdsByTarget: thresholdsByTarget(status),
    });
    const payload = roundPayload('A22', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A22), walkForward });
    const outputPath = writeRoundOutput(runDir, 'A22', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A23: async ({ status, runDir }) => {
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a22 = stagePayload(status, 'A22');
    const strongControls = runStrongControls(a22.walkForward, status.immutable.randomSeed);
    const payload = roundPayload('A23', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A23), strongControls });
    const outputPath = writeRoundOutput(runDir, 'A23', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A30: async ({ status, runDir }) => {
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a23 = stagePayload(status, 'A23');
    const sensitive = contractSensitiveFactors();
    const f3Candidates = freezeF3Candidates(a23.strongControls, sensitive);
    const payload = roundPayload('A30', status, patch.hash, {
      inputHash: stageInputHash(status, phaseADag.A30),
      contractSensitiveFactors: sensitive,
      f3Candidates,
    });
    const outputPath = writeRoundOutput(runDir, 'A30', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A31: async ({ status, runDir }) => {
    const bundle = univariateBundle(status);
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a21 = stagePayload(status, 'A21');
    const a30 = stagePayload(status, 'A30');
    const targetSpec = JSON.parse(fs.readFileSync(status.immutable.targetSpecPath, 'utf8'));
    const gamChallenger = runGamChallenger({
      candidates: a30.f3Candidates,
      evidenceBlocks: a21.evidenceBlocks,
      featureRows: bundle.featureRows,
      targetRows: bundle.targetRows,
      targetSpec,
      thresholdsByTarget: thresholdsByTarget(status),
    });
    const payload = roundPayload('A31', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A31), gamChallenger });
    const outputPath = writeRoundOutput(runDir, 'A31', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A32: async ({ status, runDir }) => {
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a31 = stagePayload(status, 'A31');
    const round3Controls = runRound3Controls(a31.gamChallenger, status.immutable.randomSeed);
    const payload = roundPayload('A32', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A32), round3Controls });
    const outputPath = writeRoundOutput(runDir, 'A32', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A33: async ({ status, runDir }) => {
    const bundle = univariateBundle(status);
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a23 = stagePayload(status, 'A23');
    const a30 = stagePayload(status, 'A30');
    const a32 = stagePayload(status, 'A32');
    const a10Results = completedPayloads(status, 'A10', (job) => job.factorId !== '__SUMMARY__');
    const a13Results = completedPayloads(status, 'A13', (job) => job.factorId !== '__SUMMARY__');
    const promotionBoard = buildPromotionBoard({
      featureRows: bundle.featureRows,
      a10Results,
      a13Results,
      strongControls: a23.strongControls,
      candidates: a30.f3Candidates,
      round3: a32.round3Controls,
      contractSensitiveFactors: contractSensitiveFactors(),
    });
    const payload = roundPayload('A33', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A33), promotionBoard });
    const outputPath = writeRoundOutput(runDir, 'A33', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
  A40: async ({ status, runDir }) => {
    const patch = blockerPatchManifest();
    if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patch.hash) throw new Error('blocker_patch_hash_mismatch');
    const a20 = stagePayload(status, 'A20');
    const a23 = stagePayload(status, 'A23');
    const a30 = stagePayload(status, 'A30');
    const a32 = stagePayload(status, 'A32');
    const a33 = stagePayload(status, 'A33');
    const reportsDir = path.join(runDir, 'reports');
    const evidencePath = path.join(reportsDir, 'PHASE_A_EVIDENCE.json');
    const evidence = {
      schemaVersion: 'phase-a-evidence-report-v1',
      runId: status.runId,
      redundancy: a20.redundancy,
      strongControls: a23.strongControls,
      f3Candidates: a30.f3Candidates,
      round3Controls: a32.round3Controls,
      promotionBoard: a33.promotionBoard,
      safeguards: status.safeguards,
    };
    deterministicJsonOutput(evidencePath, evidence);
    const counts = a33.promotionBoard.board.reduce((result, item) => {
      const key = `${item.promotionStage}_${item.evaluationStatus}`;
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    const summaryPath = path.join(reportsDir, 'EXECUTIVE_SUMMARY.md');
    const negative = a33.promotionBoard.board.filter((item) => item.evaluationStatus === 'FAIL').map((item) => item.factorId);
    const markdown = [
      '# FULL HISTORICAL RESEARCH PROGRAM v1 — Phase A Executive Summary',
      '',
      `- Run ID：${status.runId}`,
      `- Snapshot Hash：${status.immutable.snapshotHash}`,
      `- Research Spec Hash：${status.immutable.specHash}`,
      `- F3 Preregistration Candidates：${a30.f3Candidates.candidates.length}`,
      `- Contract-sensitive provisional factors：${contractSensitiveFactors().length}`,
      `- Promotion counts：${JSON.stringify(counts)}`,
      '- formalWeight=0',
      '- researchOnly=true',
      '- executionAuthorized=false',
      '',
      '## Negative／Paused Evidence',
      '',
      negative.length ? negative.map((factor) => `- ${factor}`).join('\n') : '- 無',
      '',
      '## 限制',
      '',
      '- 本研究使用已檢視歷史資料，不能視為全新Forward證據。',
      '- F3只代表預先登記候選，不代表F3 PASS。',
      '- 契約敏感因子須等待PP-1 Reconciliation，現階段不得晉升。',
      '- 不產生正式權重、Signal或交易建議。',
      '',
    ].join('\n');
    deterministicTextOutput(summaryPath, markdown);
    const reports = {
      evidence: { path: evidencePath, hash: sha256File(evidencePath) },
      executiveSummary: { path: summaryPath, hash: sha256File(summaryPath) },
      reranModels: false,
      negativeEvidenceOmitted: false,
    };
    const payload = roundPayload('A40', status, patch.hash, { inputHash: stageInputHash(status, phaseADag.A40), reports });
    const outputPath = writeRoundOutput(runDir, 'A40', payload);
    return { outputPath, inputHash: payload.inputHash };
  },
};

function heavyStageRequested(args, status) {
  return status.jobs.some((job) => (
    job.heavy
    && (job.status === 'PENDING' || (args.resume && job.status === 'FAILED'))
    && (!args.stage || args.stage === job.stage)
  ));
}

function assertHeavyExecutionAllowed(args, status) {
  if (args.dryRun) return;
  if (!heavyStageRequested(args, status)) return;
  if (!args.fullApproved) throw new Error('heavy_phase_a_requires_explicit_full_approved_flag');
  const now = new Date();
  const taipei = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const minutes = Number(taipei.hour) * 60 + Number(taipei.minute);
  if (minutes >= 8 * 60 + 15 && minutes < 13 * 60 + 50) {
    throw new Error('heavy_phase_a_forbidden_during_operations_window');
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.init) initialize(args.runDir);
if (args.rebuildReports) {
  const output = rebuildReportsFromCompleted(args.runDir);
  console.log(JSON.stringify({ ok: true, rebuilt: output, reranModels: false }, null, 2));
  process.exit(0);
}

const status = loadRunStatus(args.runDir);
assertHeavyExecutionAllowed(args, status);
const patchManifest = blockerPatchManifest();
if (status.immutable.blockerPatchHash && status.immutable.blockerPatchHash !== patchManifest.hash) {
  throw new Error('blocker_patch_hash_mismatch');
}
if (args.dryRun) {
  const preflight = preflightRun({
    status,
    handlers,
    dag: phaseADag,
    requiredStages: phaseARequiredStages,
    stage: args.stage,
  });
  console.log(JSON.stringify({
    ...preflight,
    dag: phaseADag,
    blockerPatchHash: patchManifest.hash,
    immutable: {
      snapshotHash: status.immutable.snapshotHash,
      specHash: status.immutable.specHash,
      targetSpecHash: status.immutable.targetSpecHash,
      featureSpecHash: status.immutable.featureSpecHash,
      featureVersion: status.immutable.featureVersion,
      targetVersion: status.immutable.targetVersion,
      randomSeed: status.immutable.randomSeed,
    },
    resumeCommand: `node scripts/run-full-historical-phase-a.mjs --run-dir "${args.runDir}" --resume --full-approved`,
  }, null, 2));
  process.exit(preflight.ok ? 0 : 1);
}
let result;
try {
  result = await executeRun({
    runDir: args.runDir,
    handlers,
    resume: args.resume,
    stage: args.stage,
    injectFailureJobId: args.injectFailureJobId,
    simulateCrashJobId: args.simulateCrashJobId,
    dag: phaseADag,
    requiredStages: phaseARequiredStages,
    outputValidators: Object.fromEntries(
      Object.keys(phaseADag).map((stageId) => [stageId, (outputPath) => {
        const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        validateStagePayload(stageId, payload);
      }]),
    ),
  });
} catch (error) {
  console.error(String(error?.stack || error));
  process.exit(1);
}
if (result.intentionalCrash) {
  console.error('Intentional smoke interruption left a RUNNING job and stale lock for resume validation.');
  process.exit(86);
}
const finalStatus = loadRunStatus(args.runDir);
console.log(JSON.stringify({
  ok: finalStatus.counts?.FAILED === 0,
  runDir: args.runDir,
  state: finalStatus.state,
  counts: finalStatus.counts,
  snapshotHash: finalStatus.immutable.snapshotHash,
  gitCommit: finalStatus.immutable.gitCommit,
  gitStatus: finalStatus.immutable.gitStatus,
  nextResumeCommand: path.join(args.runDir, 'NEXT_RESUME_COMMAND.txt'),
}, null, 2));
if (finalStatus.counts?.FAILED) process.exitCode = 1;
