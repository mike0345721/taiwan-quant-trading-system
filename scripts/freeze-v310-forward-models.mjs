import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitRidge } from '../src/intraday-factor-impact.mjs';
import {
  PRICE_BASELINE_KEYS,
  EVENT_TARGETS,
  HYPOTHESES,
  quantile,
} from '../src/v310-restricted-wave3.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const discoveryPath = path.join(
  root, 'data', 'intraday', 'research', 'v3.10-restricted-wave3', 'aligned-discovery.ndjson',
);
const forwardDir = path.join(
  root, 'data', 'intraday', 'research', 'v3.10-wave3-forward',
);
const specPath = path.join(forwardDir, 'restricted-frozen-spec.json');
const modelsPath = path.join(forwardDir, 'restricted-frozen-models.json');
const registryPath = path.join(forwardDir, 'restricted-forward-registry.jsonl');
const protocolPath = path.join(root, 'docs', 'research', 'V3_10_RESTRICTED_WAVE3_PROTOCOL.md');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readNdjson(target) {
  return fs.readFileSync(target, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

const frozenAt = new Date().toISOString();
const specText = fs.readFileSync(specPath, 'utf8');
const spec = JSON.parse(specText);
const protocolSha256 = sha256(fs.readFileSync(protocolPath));
if (spec.protocolSha256 !== protocolSha256) throw new Error('frozen_protocol_hash_mismatch');
if (spec.executionAuthorized !== false || spec.researchOnly !== true) {
  throw new Error('frozen_execution_boundary_invalid');
}

const discoveryText = fs.readFileSync(discoveryPath, 'utf8');
const rows = readNdjson(discoveryPath);
const frozenModels = [];
for (const hypothesis of HYPOTHESES) {
  for (const [targetName, target] of Object.entries(EVENT_TARGETS)) {
    const required = [
      ...PRICE_BASELINE_KEYS,
      hypothesis.factorKey,
      hypothesis.interactionKey,
      target.severityKey,
    ];
    const usable = rows.filter((row) => required.every((key) => finite(row[key])))
      .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
    const threshold = quantile(usable.map((row) => row[target.severityKey]), target.quantile);
    const labelled = usable.map((row) => ({
      ...row,
      __event: Number(row[target.severityKey]) >= Number(threshold) ? 1 : 0,
    }));
    const priceKeys = [...PRICE_BASELINE_KEYS];
    const factorKeys = [...PRICE_BASELINE_KEYS, hypothesis.factorKey];
    const interactionKeys = [
      ...PRICE_BASELINE_KEYS, hypothesis.factorKey, hypothesis.interactionKey,
    ];
    const priceModel = fitRidge(labelled, priceKeys, '__event', { lambda: 1 });
    const factorModel = fitRidge(labelled, factorKeys, '__event', { lambda: 1 });
    const interactionModel = fitRidge(labelled, interactionKeys, '__event', { lambda: 1 });
    if (!priceModel || !factorModel || !interactionModel) {
      throw new Error(`frozen_model_fit_failed:${hypothesis.id}:${targetName}`);
    }
    frozenModels.push({
      hypothesisId: hypothesis.id,
      targetName,
      primaryTarget: targetName === hypothesis.primaryTarget,
      trainingFirstDate: usable[0]?.tradeDate ?? null,
      trainingLastDate: usable.at(-1)?.tradeDate ?? null,
      trainingDays: usable.length,
      eventThreshold: threshold,
      eventQuantile: target.quantile,
      severityKey: target.severityKey,
      priceModel,
      factorModel,
      interactionModel,
    });
  }
}

const artifact = {
  schemaVersion: 'v3.10-restricted-frozen-models-v1',
  frozenAt,
  frozenSpecSha256: sha256(specText),
  protocolSha256,
  historicalInputSha256: sha256(discoveryText),
  historicalInputRows: rows.length,
  historicalDataConsumedThrough: rows.at(-1)?.tradeDate ?? null,
  modelType: 'ridge_linear_probability',
  lambda: 1,
  probabilityClipped: true,
  models: frozenModels,
  promotionAuthorized: false,
  researchOnly: true,
  executionAuthorized: false,
};
const artifactText = `${JSON.stringify(artifact, null, 2)}\n`;
const artifactSha256 = sha256(artifactText);
if (fs.existsSync(modelsPath)) {
  if (sha256(fs.readFileSync(modelsPath)) !== artifactSha256) {
    throw new Error('frozen_models_conflict');
  }
} else {
  fs.writeFileSync(modelsPath, artifactText, 'utf8');
}

const records = fs.readFileSync(registryPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
if (!records.some((record) => record.eventType === 'models_frozen')) {
  const prior = records.at(-1);
  const record = {
    schemaVersion: 'v3.10-restricted-forward-registry-v1',
    eventType: 'models_frozen',
    recordedAt: frozenAt,
    frozenSpecSha256: artifact.frozenSpecSha256,
    frozenModelsSha256: artifactSha256,
    historicalInputSha256: artifact.historicalInputSha256,
    modelCount: frozenModels.length,
    acceptedCleanDays: 0,
    status: 'FROZEN_WAITING_NEW_UNSEEN_DAY',
    previousRecordHash: prior?.recordHash ?? null,
    researchOnly: true,
    executionAuthorized: false,
  };
  record.recordHash = sha256(JSON.stringify(record));
  fs.appendFileSync(registryPath, `${JSON.stringify(record)}\n`, 'utf8');
}

console.log(JSON.stringify({
  modelsPath,
  registryPath,
  historicalRows: rows.length,
  modelCount: frozenModels.length,
  historicalInputSha256: artifact.historicalInputSha256,
  frozenModelsSha256: artifactSha256,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));

