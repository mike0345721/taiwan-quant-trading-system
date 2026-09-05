import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  generatedArtifacts,
  loadRegistry,
  validateRegistry
} from '../src/data-requirements-v1.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registry = loadRegistry(root);

test('CRU-39 registry baseline is internally valid and has no blocking gaps', () => {
  const result = validateRegistry(registry, { root });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.counts.blocking_conflicts, 0);
  assert.ok(result.counts.datasets >= 40);
});

test('generated master views are byte-identical to the canonical registry', () => {
  for (const [relativePath, expected] of generatedArtifacts(registry)) {
    const actual = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.equal(actual, expected, `${relativePath} is stale`);
  }
});

test('duplicate IDs, proxy identity reuse, missing zero policy, and availability alias fail closed', () => {
  const duplicate = structuredClone(registry);
  duplicate.datasets.push(structuredClone(duplicate.datasets[0]));
  assert.match(validateRegistry(duplicate).errors.join('\n'), /duplicate dataset_id/);

  const proxy = structuredClone(registry);
  const ndx = proxy.datasets.find((dataset) => dataset.dataset_id === 'ndx_proxy_daily');
  ndx.identity_requirements.proxy_of = ndx.identity_requirements.canonical_identity;
  assert.match(validateRegistry(proxy).errors.join('\n'), /proxy identity cannot equal canonical identity/);

  const missing = structuredClone(registry);
  missing.datasets[0].missing_value_policy = 'ZERO_DEFAULT';
  assert.match(validateRegistry(missing).errors.join('\n'), /missing_value_policy/);

  const timestamp = structuredClone(registry);
  timestamp.datasets[0].timestamp_semantics.available_at = timestamp.datasets[0].timestamp_semantics.received_at;
  assert.match(validateRegistry(timestamp).errors.join('\n'), /available_at cannot silently alias received_at/);
});

test('formal usage and outcome future leakage cannot be declared by registry data', () => {
  const formal = structuredClone(registry);
  formal.datasets.find((dataset) => dataset.dataset_id === 'ndx_proxy_daily').usage_eligibility = ['FORMAL_RESEARCH'];
  assert.match(validateRegistry(formal).errors.join('\n'), /replay\/forward\/formal usage requires/);

  const outcome = structuredClone(registry);
  outcome.datasets.find((dataset) => dataset.dataset_id === 'decision_evidence_and_outcome_records').feeds_decision_features = ['market_intelligence_expected_control_state'];
  assert.match(validateRegistry(outcome).errors.join('\n'), /Outcome cannot be an input dependency/);
});

test('dependency fields and universe coverage are fail-closed', () => {
  const malformed = structuredClone(registry);
  malformed.datasets.find((dataset) => dataset.dataset_id === 'derived_pressure_response_efficiency').input_dataset_ids = 'tx_actual_trade';
  assert.match(validateRegistry(malformed).errors.join('\n'), /input_dataset_ids: must be an array/);

  const missingOutcomeField = structuredClone(registry);
  delete missingOutcomeField.datasets.find((dataset) => dataset.dataset_id === 'decision_evidence_and_outcome_records').feeds_decision_features;
  assert.match(validateRegistry(missingOutcomeField).errors.join('\n'), /OUTCOME dataset requires a feeds_decision_features array/);

  const unknownOutcomeFeature = structuredClone(registry);
  unknownOutcomeFeature.datasets.find((dataset) => dataset.dataset_id === 'decision_evidence_and_outcome_records').feeds_decision_features = ['does_not_exist'];
  assert.match(validateRegistry(unknownOutcomeFeature).errors.join('\n'), /feeds_decision_features: unknown dataset does_not_exist/);

  const escapedEvidence = structuredClone(registry);
  escapedEvidence.datasets.find((dataset) => dataset.dataset_id === 'tx_ohlcv_1m_5m').asset_refs[0].runtime_evidence = path.resolve(root, '..', 'outside.json');
  assert.match(validateRegistry(escapedEvidence, { root }).errors.join('\n'), /VERIFIED asset requires a persisted artifact runtime_evidence path/);

  const unknownCoverage = structuredClone(registry);
  unknownCoverage.universe_coverage.SPOT.unknown_component = 'does_not_exist';
  assert.match(validateRegistry(unknownCoverage).errors.join('\n'), /unknown dataset does_not_exist/);
});

test('safety invariants and unavailable-quality eligibility are fail-closed', () => {
  const safety = structuredClone(registry);
  safety.safety_invariants.executionAuthorized = true;
  assert.match(validateRegistry(safety).errors.join('\n'), /executionAuthorized/);

  const unavailable = structuredClone(registry);
  const candidate = unavailable.datasets.find((dataset) => dataset.dataset_id === 'twn_futures');
  candidate.usage_eligibility = ['DESCRIPTIVE'];
  assert.match(validateRegistry(unavailable).errors.join('\n'), /UNAVAILABLE quality cannot claim an eligibility/);
});
