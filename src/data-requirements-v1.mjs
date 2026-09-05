import fs from 'node:fs';
import path from 'node:path';

export const REGISTRY_RELATIVE_PATH = 'config/data-requirements-v1.json';

const PRIORITIES = ['CORE', 'HIGH_VALUE', 'OPTIONAL'];
const DOMAINS = [
  'PRICE_MICROSTRUCTURE',
  'POSITION',
  'SPOT_INDEX_STRUCTURE',
  'CROSS_MARKET',
  'PRESSURE_RESPONSE_EFFICIENCY',
  'MARKET_INTELLIGENCE',
  'DECISION_OUTCOME_EV',
  'REFERENCE_DATA',
  'DATA_TRUTH_OPERATIONS'
];
const DATA_KINDS = ['RAW', 'REFERENCE', 'DERIVED', 'MODEL_OUTPUT', 'OWN_RECORD'];
const ACQUISITION = ['OFFICIAL', 'BROKER', 'VENDOR', 'EXISTING', 'DERIVED', 'OWN_RECORD', 'OWN_EVENT', 'LIVE_STREAM', 'DAILY_DOWNLOAD', 'CHANGE_SNAPSHOT', 'UNKNOWN', 'NOT_NEEDED'];
const REQUIREMENT_STATUSES = ['REQUIRED', 'CANDIDATE', 'DEFERRED', 'REJECTED'];
const INVENTORY_STATUSES = ['VERIFIED_PRESENT', 'PARTIAL', 'NOT_FOUND', 'PROXY_ONLY', 'NOT_VERIFIED', 'CANDIDATE'];
const IMPLEMENTATION_STATUSES = ['IMPLEMENTED', 'PARTIAL', 'DESIGN_ONLY', 'NOT_IMPLEMENTED', 'OWN_RECORD_ONLY', 'UNKNOWN'];
const COVERAGE_STATUSES = ['VERIFIED', 'PARTIAL', 'NONE', 'NOT_VERIFIED', 'CANDIDATE'];
const LICENSE_STATUSES = ['APPROVED_INTERNAL', 'SOURCE_LIMITED', 'NOT_VERIFIED', 'NOT_APPLICABLE'];
const QUALITY_STATUSES = ['PASS', 'QUALITY_LIMITED', 'QUALITY_INSUFFICIENT', 'UNAVAILABLE', 'NOT_VERIFIED', 'NOT_APPLICABLE'];
const USAGE = ['DESCRIPTIVE', 'HISTORICAL_RESEARCH', 'POINT_IN_TIME_REPLAY', 'FORWARD', 'FORMAL_RESEARCH', 'NOT_ELIGIBLE', 'UNKNOWN'];
const ASSET_STATUSES = ['VERIFIED', 'PRESENT', 'PARTIAL', 'NOT_VERIFIED'];
const EVIDENCE_QUALIFICATIONS = ['GOVERNED', 'UNQUALIFIED'];
const DECISION_TIME_ROLES = ['OBSERVATION', 'INPUT', 'OUTPUT', 'OUTCOME'];
const GAP_TYPES = [
  'DOCUMENT_CONFLICT',
  'IMPLEMENTATION_GAP',
  'COVERAGE_GAP',
  'LICENSE_GAP',
  'QUALITY_GAP',
  'TIMESTAMP_GAP',
  'REPLAY_GAP',
  'OWNER_DECISION_REQUIRED',
  'DUPLICATE_REQUIREMENT',
  'OVER_GRANULAR_REQUIREMENT',
  'NOT_VERIFIED'
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const addError = (errors, pathName, message) => errors.push(`${pathName}: ${message}`);
const looksLikePersistedArtifact = (value) => {
  if (!isNonEmptyString(value) || /NOT_VERIFIED/i.test(value)) return false;
  const trimmed = value.trim();
  if (path.isAbsolute(trimmed) || trimmed.replaceAll('\\', '/').split('/').includes('..')) return false;
  if (/^(docs|config)\//i.test(trimmed)) return false;
  return /\.(json|jsonl|ndjson|sqlite|db)$/i.test(trimmed);
};

export function loadRegistry(root) {
  const filePath = path.join(root, REGISTRY_RELATIVE_PATH);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function validateRegistry(registry, { root = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(registry)) return { ok: false, errors: ['registry: expected an object'], warnings, counts: {} };

  for (const field of ['schema_version', 'master_version', 'approved_main', 'registry_id']) {
    if (!isNonEmptyString(registry[field])) addError(errors, 'registry', `missing ${field}`);
  }
  if (!isObject(registry.safety_invariants)) addError(errors, 'registry.safety_invariants', 'must be an object');
  for (const [field, expected] of [['formalWeight', 0], ['researchOnly', true], ['executionAuthorized', false], ['orderRoutesEnabled', false]]) {
    if (registry.safety_invariants?.[field] !== expected) addError(errors, `registry.safety_invariants.${field}`, `must equal ${expected}`);
  }
  if (registry.schema_version !== 'data-requirements-v1') addError(errors, 'registry.schema_version', 'must be data-requirements-v1');
  if (!Array.isArray(registry.datasets) || registry.datasets.length === 0) addError(errors, 'registry.datasets', 'must be a non-empty array');
  if (!isObject(registry.audit_basis)) addError(errors, 'registry.audit_basis', 'must be an object');
  if (!isObject(registry.universe_coverage)) addError(errors, 'registry.universe_coverage', 'must be an object');
  if (!Array.isArray(registry.conflicts)) addError(errors, 'registry.conflicts', 'must be an array');

  const ids = new Set();
  const datasets = Array.isArray(registry.datasets) ? registry.datasets : [];
  const datasetById = new Map();
  for (const dataset of datasets) if (isObject(dataset) && isNonEmptyString(dataset.dataset_id)) datasetById.set(dataset.dataset_id, dataset);
  for (const [index, dataset] of datasets.entries()) {
    const prefix = `datasets[${index}]`;
    if (!isObject(dataset)) {
      addError(errors, prefix, 'must be an object');
      continue;
    }
    if (!isNonEmptyString(dataset.dataset_id)) addError(errors, prefix, 'missing dataset_id');
    if (ids.has(dataset.dataset_id)) addError(errors, prefix, `duplicate dataset_id ${dataset.dataset_id}`);
    ids.add(dataset.dataset_id);
    for (const field of [
      'domain', 'data_kind', 'purpose', 'minimum_granularity', 'identity_requirements',
      'historical_acquisition', 'ongoing_acquisition', 'requirement_status', 'inventory_status',
      'implementation_status', 'coverage_status', 'license_status', 'quality_status',
      'timestamp_semantics', 'replay_requirement', 'retention_requirement', 'owner_gate', 'notes',
      'evidence_qualification', 'decision_time_role'
    ]) {
      if (!(field in dataset)) addError(errors, prefix, `missing ${field}`);
    }
    if (!DOMAINS.includes(dataset.domain)) addError(errors, `${prefix}.domain`, `invalid value ${dataset.domain}`);
    if (!DATA_KINDS.includes(dataset.data_kind)) addError(errors, `${prefix}.data_kind`, `invalid value ${dataset.data_kind}`);
    if (!PRIORITIES.includes(dataset.priority)) addError(errors, `${prefix}.priority`, `invalid value ${dataset.priority}`);
    if (!REQUIREMENT_STATUSES.includes(dataset.requirement_status)) addError(errors, `${prefix}.requirement_status`, `invalid value ${dataset.requirement_status}`);
    if (!EVIDENCE_QUALIFICATIONS.includes(dataset.evidence_qualification)) addError(errors, `${prefix}.evidence_qualification`, `invalid value ${dataset.evidence_qualification}`);
    if (!DECISION_TIME_ROLES.includes(dataset.decision_time_role)) addError(errors, `${prefix}.decision_time_role`, `invalid value ${dataset.decision_time_role}`);
    for (const [field, allowed] of [
      ['historical_acquisition', ACQUISITION], ['ongoing_acquisition', ACQUISITION],
      ['inventory_status', INVENTORY_STATUSES], ['implementation_status', IMPLEMENTATION_STATUSES],
      ['coverage_status', COVERAGE_STATUSES], ['license_status', LICENSE_STATUSES], ['quality_status', QUALITY_STATUSES]
    ]) {
      if (!allowed.includes(dataset[field])) addError(errors, `${prefix}.${field}`, `invalid value ${dataset[field]}`);
    }
    if (!Array.isArray(dataset.required_by) || dataset.required_by.length === 0) addError(errors, `${prefix}.required_by`, 'must be non-empty');
    if (!isNonEmptyString(dataset.minimum_granularity)) addError(errors, `${prefix}.minimum_granularity`, 'must be non-empty');
    if (!isObject(dataset.identity_requirements)) addError(errors, `${prefix}.identity_requirements`, 'must be an object');
    if (!isObject(dataset.timestamp_semantics)) addError(errors, `${prefix}.timestamp_semantics`, 'must be an object');
    if (!isObject(dataset.replay_requirement)) addError(errors, `${prefix}.replay_requirement`, 'must be an object');
    if (!isObject(dataset.retention_requirement)) addError(errors, `${prefix}.retention_requirement`, 'must be an object');
    for (const field of ['source_refs', 'asset_refs', 'blockers', 'usage_eligibility']) {
      if (!Array.isArray(dataset[field])) addError(errors, `${prefix}.${field}`, 'must be an array');
    }
    for (const [refIndex, ref] of (dataset.source_refs || []).entries()) {
      if (!isObject(ref) || !isNonEmptyString(ref.ref) || !isNonEmptyString(ref.kind) || !isNonEmptyString(ref.status)) addError(errors, `${prefix}.source_refs[${refIndex}]`, 'requires ref, kind and status');
    }
    for (const [assetIndex, asset] of (dataset.asset_refs || []).entries()) {
      if (!isObject(asset)) {
        addError(errors, `${prefix}.asset_refs[${assetIndex}]`, 'must be an object');
        continue;
      }
      for (const field of ['status', 'schema_table', 'file_path', 'collector_importer', 'api_provider', 'contract_spec', 'tests', 'research_consumer', 'ui_consumer', 'runtime_evidence']) {
        if (!(field in asset)) addError(errors, `${prefix}.asset_refs[${assetIndex}]`, `missing ${field}`);
      }
      if (!ASSET_STATUSES.includes(asset.status)) addError(errors, `${prefix}.asset_refs[${assetIndex}].status`, `invalid value ${asset.status}`);
      if (asset.status === 'VERIFIED' && !looksLikePersistedArtifact(asset.runtime_evidence)) addError(errors, `${prefix}.asset_refs[${assetIndex}]`, 'VERIFIED asset requires a persisted artifact runtime_evidence path');
    }
    if (dataset.missing_value_policy !== 'UNKNOWN_NOT_ZERO') addError(errors, `${prefix}.missing_value_policy`, 'must be UNKNOWN_NOT_ZERO');
    if (!isNonEmptyString(dataset.timestamp_semantics.event_time) || !isNonEmptyString(dataset.timestamp_semantics.received_at) || !isNonEmptyString(dataset.timestamp_semantics.available_at)) {
      addError(errors, `${prefix}.timestamp_semantics`, 'event_time, received_at and available_at must be explicit');
    }
    if (dataset.timestamp_semantics.available_at === dataset.timestamp_semantics.received_at) addError(errors, `${prefix}.timestamp_semantics`, 'available_at cannot silently alias received_at');
    const identity = dataset.identity_requirements || {};
    if (identity.proxy_of && identity.proxy_of === identity.canonical_identity) addError(errors, `${prefix}.identity_requirements`, 'proxy identity cannot equal canonical identity');
    if (dataset.requirement_status === 'REQUIRED' && dataset.priority === 'OPTIONAL') addError(errors, `${prefix}`, 'REQUIRED dataset cannot be OPTIONAL');
    if (dataset.requirement_status === 'REJECTED' && dataset.usage_eligibility?.some((item) => item !== 'NOT_ELIGIBLE')) addError(errors, `${prefix}.usage_eligibility`, 'REJECTED dataset must be NOT_ELIGIBLE only');
    const usage = dataset.usage_eligibility || [];
    if (usage.includes('NOT_ELIGIBLE') && usage.length !== 1) addError(errors, `${prefix}.usage_eligibility`, 'NOT_ELIGIBLE cannot be combined with another eligibility');
    if (['UNAVAILABLE', 'NOT_VERIFIED'].includes(dataset.quality_status) && usage.some((item) => !['NOT_ELIGIBLE', 'UNKNOWN'].includes(item))) addError(errors, `${prefix}.usage_eligibility`, `${dataset.quality_status} quality cannot claim an eligibility`);
    if (['POINT_IN_TIME_REPLAY', 'FORWARD', 'FORMAL_RESEARCH'].some((item) => usage.includes(item))) {
      if (dataset.license_status !== 'APPROVED_INTERNAL') addError(errors, `${prefix}`, 'replay/forward/formal usage requires APPROVED_INTERNAL license evidence');
      if (dataset.quality_status !== 'PASS') addError(errors, `${prefix}`, 'replay/forward/formal usage requires PASS quality');
      if (dataset.evidence_qualification !== 'GOVERNED') addError(errors, `${prefix}`, 'replay/forward/formal usage requires GOVERNED evidence qualification');
    }
    if (dataset.decision_time_role === 'OUTCOME' && Array.isArray(dataset.feeds_decision_features) && dataset.feeds_decision_features.length > 0) {
      addError(errors, `${prefix}.feeds_decision_features`, 'Outcome cannot be an input dependency of a decision-time feature');
    }
    if ('input_dataset_ids' in dataset && !Array.isArray(dataset.input_dataset_ids)) addError(errors, `${prefix}.input_dataset_ids`, 'must be an array when present');
    if ('feeds_decision_features' in dataset && !Array.isArray(dataset.feeds_decision_features)) addError(errors, `${prefix}.feeds_decision_features`, 'must be an array when present');
    for (const inputId of Array.isArray(dataset.input_dataset_ids) ? dataset.input_dataset_ids : []) {
      if (!datasetById.has(inputId)) addError(errors, `${prefix}.input_dataset_ids`, `unknown dataset ${inputId}`);
      const input = datasetById.get(inputId);
      if (input?.decision_time_role === 'OUTCOME') addError(errors, `${prefix}.input_dataset_ids`, `cannot consume outcome dataset ${inputId} at decision time`);
    }
    for (const featureId of Array.isArray(dataset.feeds_decision_features) ? dataset.feeds_decision_features : []) {
      if (!datasetById.has(featureId)) addError(errors, `${prefix}.feeds_decision_features`, `unknown dataset ${featureId}`);
      if (dataset.decision_time_role === 'OUTCOME' && datasetById.get(featureId)?.decision_time_role === 'OUTCOME') {
        addError(errors, `${prefix}.feeds_decision_features`, `cannot use outcome dataset ${featureId} as a decision-time feature`);
      }
    }
    if (dataset.decision_time_role === 'OUTPUT' && !Array.isArray(dataset.input_dataset_ids)) addError(errors, `${prefix}.input_dataset_ids`, 'OUTPUT dataset requires an input_dataset_ids array');
    if (dataset.decision_time_role === 'OUTCOME' && !Array.isArray(dataset.feeds_decision_features)) addError(errors, `${prefix}.feeds_decision_features`, 'OUTCOME dataset requires a feeds_decision_features array');
    if (dataset.inventory_status === 'VERIFIED_PRESENT') {
      const hasPersistedEvidence = (dataset.asset_refs || []).some((asset) => isObject(asset) && ['VERIFIED', 'PRESENT'].includes(asset.status) && looksLikePersistedArtifact(asset.runtime_evidence));
      if (!hasPersistedEvidence) addError(errors, `${prefix}.asset_refs`, 'VERIFIED_PRESENT requires persisted runtime evidence');
    }
    if (root) {
      const rootPath = path.resolve(root);
      const persistedPaths = (dataset.asset_refs || []).map((asset) => asset?.runtime_evidence).filter(looksLikePersistedArtifact);
      for (const evidencePath of persistedPaths) {
        const resolvedEvidencePath = path.resolve(rootPath, evidencePath);
        const relativeEvidencePath = path.relative(rootPath, resolvedEvidencePath);
        if (!relativeEvidencePath || relativeEvidencePath.startsWith('..') || path.isAbsolute(relativeEvidencePath)) {
          addError(errors, `${prefix}.asset_refs`, `runtime evidence path escapes root: ${evidencePath}`);
        } else if (dataset.inventory_status === 'VERIFIED_PRESENT' && !fs.existsSync(resolvedEvidencePath)) {
          addError(errors, `${prefix}.asset_refs`, `runtime evidence path does not exist: ${evidencePath}`);
        }
      }
    }
    if (dataset.requirement_status === 'REQUIRED' && dataset.inventory_status === 'NOT_VERIFIED') warnings.push(`${prefix}: REQUIRED but inventory is NOT_VERIFIED`);
  }

  for (const [section, mappings] of Object.entries(registry.universe_coverage || {})) {
    if (!isObject(mappings)) {
      addError(errors, `universe_coverage.${section}`, 'must be an object');
      continue;
    }
    for (const [label, datasetId] of Object.entries(mappings)) {
      if (!isNonEmptyString(datasetId) || !datasetById.has(datasetId)) addError(errors, `universe_coverage.${section}.${label}`, `unknown dataset ${datasetId}`);
    }
  }

  for (const [index, conflict] of (Array.isArray(registry.conflicts) ? registry.conflicts : []).entries()) {
    const prefix = `conflicts[${index}]`;
    if (!isObject(conflict)) {
      addError(errors, prefix, 'must be an object');
      continue;
    }
    for (const field of ['conflict_id', 'type', 'truth', 'recommended_next_owner', 'recommended_work_item']) {
      if (!isNonEmptyString(conflict[field])) addError(errors, prefix, `missing ${field}`);
    }
    if (!GAP_TYPES.includes(conflict.type)) addError(errors, `${prefix}.type`, `invalid value ${conflict.type}`);
    if (!Array.isArray(conflict.impacted_dataset_ids) || conflict.impacted_dataset_ids.length === 0) addError(errors, `${prefix}.impacted_dataset_ids`, 'must be non-empty');
    for (const id of conflict.impacted_dataset_ids || []) if (!ids.has(id)) addError(errors, `${prefix}.impacted_dataset_ids`, `unknown dataset ${id}`);
  }

  const counts = {
    datasets: datasets.length,
    required: datasets.filter((dataset) => dataset.requirement_status === 'REQUIRED').length,
    candidate: datasets.filter((dataset) => dataset.requirement_status === 'CANDIDATE').length,
    deferred: datasets.filter((dataset) => dataset.requirement_status === 'DEFERRED').length,
    conflicts: Array.isArray(registry.conflicts) ? registry.conflicts.length : 0,
    blocking_conflicts: Array.isArray(registry.conflicts) ? registry.conflicts.filter((conflict) => conflict.blocking === true).length : 0
  };
  return { ok: errors.length === 0, errors, warnings, counts };
}

const md = (value) => {
  if (value === null || value === undefined) return 'UNKNOWN';
  if (Array.isArray(value)) return value.join(', ');
  if (isObject(value)) return Object.values(value).map(md).join('; ');
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
};
const sortedDatasets = (registry) => [...registry.datasets].sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.dataset_id.localeCompare(b.dataset_id));
const assetText = (dataset, field) => [...new Set((dataset.asset_refs || []).map((asset) => asset?.[field]).filter(isNonEmptyString))].join('<br>') || 'UNKNOWN';
const sourceText = (dataset) => [...new Set((dataset.source_refs || []).map((source) => source?.ref).filter(isNonEmptyString))].join('<br>') || 'UNKNOWN';
const usageText = (dataset) => dataset.usage_eligibility?.join(', ') || 'UNKNOWN';

export function renderMasterRequirements(registry) {
  const validation = validateRegistry(registry);
  const rows = sortedDatasets(registry).map((dataset) => `| ${md(dataset.priority)} | ${md(dataset.domain)} | \`${md(dataset.dataset_id)}\` | ${md(dataset.purpose)} | ${md(dataset.required_by)} | ${md(dataset.minimum_granularity)} | ${md(dataset.historical_acquisition)} | ${md(dataset.ongoing_acquisition)} | ${md(`${dataset.inventory_status} / ${dataset.implementation_status}`)} | ${md(dataset.license_status)} | ${md(dataset.quality_status)} | ${md(usageText(dataset))} | ${md(dataset.input_dataset_ids)} | ${md(dataset.evidence_qualification)} | ${md(dataset.next_action)} |`).join('\n');
  return `# Master Data Requirements V1

> Generated from \`config/data-requirements-v1.json\` by \`scripts/validate-data-requirements-v1.mjs --write\`. This is a human-readable view, not a second source of truth.

## Registry identity

- Registry: \`${registry.registry_id}\`
- Schema: \`${registry.schema_version}\`
- Master version: \`${registry.master_version}\`
- Approved main baseline: \`${registry.approved_main}\`
- Generated at: ${registry.generated_at}
- Validation: ${validation.ok ? 'PASS' : 'FAIL'} (${validation.counts.datasets} datasets, ${validation.counts.conflicts} conflicts)
- Safety: \`formalWeight=0\`, \`researchOnly=true\`, \`executionAuthorized=false\`, \`orderRoutesEnabled=false\`

## Governance boundary

${registry.governance_boundary.map((line) => `- ${line}`).join('\n')}

## Project-wide audit basis

${registry.audit_basis.paths.map((item) => `- ${item}`).join('\n')}

Notion references requested by CRU-39 are recorded as ${registry.audit_basis.notion_status}; no unavailable workspace source is promoted to implementation evidence.

## Dataset universe coverage

${Object.entries(registry.universe_coverage).map(([section, mappings]) => `### ${section}\n\n${Object.entries(mappings).map(([label, datasetId]) => `- ${label}: \`${datasetId}\``).join('\n')}`).join('\n\n')}

## Dataset requirements

| Priority | Domain | Dataset ID | Purpose | Required by | Minimum granularity | Historical | Ongoing | Current status | License | Quality | Usage | Input dataset IDs | Evidence qualification | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows}

## Reading rules

- UNKNOWN and missing are not zero or neutral.
- A proxy remains a proxy and cannot reuse the canonical identity of the source it stands in for.
- A table or code path is not evidence that data exists; persisted runtime evidence is required for VERIFIED_PRESENT.
- Historical acquisition and ongoing acquisition are independent columns.
- Formal, forward, and point-in-time replay eligibility requires approved license evidence, PASS quality, and governed evidence qualification.
- Outcome datasets are never inputs to same-decision-time features.
`;
}

export function renderAssetMapping(registry) {
  const rows = sortedDatasets(registry).map((dataset) => `| \`${md(dataset.dataset_id)}\` | ${md(dataset.inventory_status)} | ${md(dataset.implementation_status)} | ${assetText(dataset, 'schema_table')} | ${assetText(dataset, 'file_path')} | ${assetText(dataset, 'collector_importer')} | ${assetText(dataset, 'api_provider')} | ${assetText(dataset, 'contract_spec')} | ${assetText(dataset, 'tests')} | ${assetText(dataset, 'research_consumer')} | ${assetText(dataset, 'ui_consumer')} | ${assetText(dataset, 'runtime_evidence')} | ${md(`${dataset.input_dataset_ids || 'UNKNOWN'} / ${dataset.evidence_qualification}`)} |`).join('\n');
  return `# Master Data Asset Mapping V1

> Generated from \`config/data-requirements-v1.json\`. Asset presence, implementation, coverage, license, quality, and eligibility are intentionally separate classifications.

- Registry: \`${registry.registry_id}\`
- Baseline: \`${registry.approved_main}\`
- Rule: no persisted evidence means \`NOT_VERIFIED\`; a table or code path alone does not mean data exists.

| Dataset ID | Inventory | Implementation | Schema / table | File path | Collector / importer | API / provider | Contract / spec | Tests | Research consumer | UI consumer | Runtime evidence | Inputs / evidence qualification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows}
`;
}

export function renderAcquisitionMatrix(registry) {
  const rows = sortedDatasets(registry).map((dataset) => `| ${md(dataset.priority)} | \`${md(dataset.dataset_id)}\` | ${md(dataset.minimum_granularity)} | ${md(dataset.historical_acquisition)} | ${md(dataset.ongoing_acquisition)} | ${md(dataset.requirement_status)} | ${md(dataset.coverage_status)} | ${md(dataset.license_status)} | ${md(dataset.quality_status)} | ${md(usageText(dataset))} | ${md(dataset.blockers)} |`).join('\n');
  return `# Master Data Acquisition Matrix V1

> Generated from \`config/data-requirements-v1.json\`. Historical and ongoing acquisition are separate decisions; this matrix does not authorize a source, account, collector, or runtime activation.

- Registry: \`${registry.registry_id}\`
- Baseline: \`${registry.approved_main}\`
- Safety: \`formalWeight=0\`, \`researchOnly=true\`, \`executionAuthorized=false\`, \`orderRoutesEnabled=false\`

| Priority | Dataset ID | Minimum granularity | Historical acquisition | Ongoing acquisition | Requirement | Coverage | License | Quality | Usage eligibility | Blockers |
|---|---|---|---|---|---|---|---|---|---|---|
${rows}

## Specific CRU-39 treatment

- TXO OI is historical \`OFFICIAL\` and ongoing \`DAILY_DOWNLOAD\`; it is not classified as LIVE_TICK.
- TWN historical and ongoing acquisition remain \`UNKNOWN\` until CRU-37 / CRU-38 evidence and owner authorization establish a lawful source.
- TWN 14:00–15:00 Price Discovery V1 may be tested as \`1M_CANDIDATE_PENDING_VALIDATION\`; it is not silently promoted to a tick requirement.
- Candidates and gaps remain registry records; they do not create implementation authorization.
`;
}

export function renderConflictGapRegister(registry) {
  const rows = registry.conflicts.map((conflict) => `| \`${md(conflict.conflict_id)}\` | ${md(conflict.type)} | ${md(conflict.truth)} | ${md(conflict.impacted_dataset_ids.map((id) => `\`${id}\``))} | ${md(conflict.recommended_next_owner)} | ${md(conflict.recommended_work_item)} | ${conflict.blocking ? 'YES' : 'NO'} |`).join('\n');
  return `# Master Data Conflict / Gap Register V1

> Generated from \`config/data-requirements-v1.json\`. This register records truth, impact, and the recommended next owner/work item; it does not attempt to fix every gap in CRU-39.

- Registry: \`${registry.registry_id}\`
- Baseline: \`${registry.approved_main}\`
- Blocking findings in registry: ${registry.conflicts.filter((conflict) => conflict.blocking).length}

| Conflict ID | Type | Truth | Impacted dataset IDs | Recommended next owner | Recommended work item | Blocking |
|---|---|---|---|---|---|---|
${rows}

## Interpretation

- \`NOT_VERIFIED\` is an explicit state, not a claim that the source is absent.
- Historical roadmap text is not implementation evidence.
- Source/license, timestamp, replay, and owner-decision gaps remain fail-closed.
`;
}

export function renderTaskContextPacketTemplate(registry) {
  return `# Task Context Packet Template

> Generated from \`config/data-requirements-v1.json\`. Every task packet must name the registry and dataset IDs it consumes; do not create a parallel data definition.

- Registry: \`${registry.registry_id}\`
- Master version: \`${registry.master_version}\`
- Registry path: \`config/data-requirements-v1.json\`

## WORK ITEM

- Work item:
- Owner / team:
- Requested date:

## OWNER AUTHORIZATION

- Owner decision / Linear reference:
- Authorized phase:
- Explicitly not authorized:

## MASTER VERSION

- Registry ID: \`${registry.registry_id}\`
- Required dataset IDs:
- Related contracts / specs:

## CURRENT ASSET EVIDENCE

- Schema / table:
- File path:
- Collector / importer:
- API / provider:
- Tests:
- Research / UI consumer:
- Runtime evidence:

## COVERAGE / QUALITY

- Implementation status:
- Coverage status:
- License status:
- Quality status:
- Timestamp semantics:
- Replay eligibility:
- Retention requirement:
- Unknown / missing-value treatment: UNKNOWN, never zero or neutral.

## BLOCKERS

- Registry conflict / gap IDs:
- Owner decisions required:
- Data or evidence blockers:

## ALLOWED CHANGES

-

## PROHIBITED CHANGES

- New source, collector, migration, storage migration, strategy, Market State promotion, broker/order/position/risk/execution, or formal-weight change unless explicitly authorized.

## ACCEPTANCE

- Deterministic validation:
- Focused tests:
- Evidence audit:
- Review verdict:

## SAFETY

\`formalWeight=0\`
\`researchOnly=true\`
\`executionAuthorized=false\`
\`orderRoutesEnabled=false\`
`;
}

export function generatedArtifacts(registry) {
  return new Map([
    ['docs/data/MASTER_DATA_REQUIREMENTS_V1.md', renderMasterRequirements(registry)],
    ['docs/data/MASTER_DATA_ASSET_MAPPING_V1.md', renderAssetMapping(registry)],
    ['docs/data/MASTER_DATA_ACQUISITION_MATRIX_V1.md', renderAcquisitionMatrix(registry)],
    ['docs/data/MASTER_DATA_CONFLICT_GAP_V1.md', renderConflictGapRegister(registry)],
    ['docs/governance/TASK_CONTEXT_PACKET_TEMPLATE.md', renderTaskContextPacketTemplate(registry)]
  ]);
}
