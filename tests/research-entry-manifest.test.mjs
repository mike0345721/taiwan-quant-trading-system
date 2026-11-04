// Synthetic regression for the versioned candidate-only ReaderOnly entry.
// Pure source/VM fixture: never runs PowerShell, Node --env-file, entry startup,
// config imports, real manifest/calendar reads, sockets, or process launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../scripts/start-research-workbench.ps1', import.meta.url), 'utf8');
const begin = source.indexOf('// ENTRY_MANIFEST_R3_PURE_BEGIN');
const end = source.indexOf('// ENTRY_MANIFEST_R3_PURE_END');
assert.ok(begin >= 0 && end > begin);
const context = {};
vm.runInNewContext(source.slice(begin, end) + '\nglobalThis.fixtureApi = { pin: OPERATIONS_PIN, assertEntryRouting, assertPinnedOperationsSnapshot };', context);
const { pin, assertEntryRouting, assertPinnedOperationsSnapshot } = context.fixtureApi;
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const p = clone(pin), checked = [];
  const sources = Object.fromEntries(['activeAppRoot', 'ledgerDataRoot', 'databasePath', 'dailyStatusPath', 'registryPath', 'registrySha256'].map(key => [key, p[key]]));
  sources.derivedArtifactPaths = [p.derivedArtifactPath];
  sources.sessionsByCheckpoint = Object.fromEntries(['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT'].map(key => [key, ['DAY', 'NIGHT']]));
  const manifest = { schemaVersion: 'data-operations-input-index-v1', governanceState: 'GOVERNED', governanceReference: p.governanceReference,
    selection: 'BUILD_A1', evidenceRoot: p.evidenceRoot, calendarSha256: p.calendarSha256, supersedesManifestSha256: p.supersedesManifestSha256,
    sourceBindings: sources, operationsBinding: { schemaVersion: 'data-operations-binding-v1', dataRoot: p.dataRoot, outputRoot: p.outputRoot, calendarPath: p.calendarPath } };
  const binding = { manifest, manifestSha256: p.manifestSha256, dataRoot: p.dataRoot, outputRoot: p.outputRoot,
    evidenceRoot: p.evidenceRoot, calendarPath: p.calendarPath, calendar: { fileHash: p.calendarSha256 } };
  return { requestedMode: 'ReaderOnly', configuration: { candidateReadOnly: true, candidateV2Binding: 'GOVERNED_ACTIVE_V1', appRoot: p.candidateRoot }, manifestPath: p.manifestPath,
    binding, registryHash: p.registrySha256, candidateCalendarHash: p.calendarSha256, checked,
    assertNoLinks: path => checked.push(path) };
}
const environment = () => ({ IX0001_LEADERSHIP_COLLECTION_ENABLED: 'true', DATA_OPERATIONS_MANIFEST_PATH: pin.manifestPath,
  DASHBOARD_CANDIDATE_V2_BINDING: 'GOVERNED_ACTIVE_V1' });

test('only the exact governed tuple in actual read-only config is accepted', () => {
  const f = fixture();
  assertEntryRouting(environment(), 'ReaderOnly');
  assertPinnedOperationsSnapshot(f);
  assert.equal(f.checked.length, 12);
  assert.ok(f.checked.includes(pin.databasePath));
  assert.ok(f.checked.includes(pin.manifestPath));
  assert.ok(f.checked.includes(pin.candidateRoot + '/config/taifex-official-calendar-2026.json'));
});

test('equivalent slash spelling is accepted without case folding or path normalization', () => {
  const f = fixture(); f.manifestPath = pin.manifestPath.replaceAll('/', '\\');
  assertEntryRouting({ ...environment(), DATA_OPERATIONS_MANIFEST_PATH: f.manifestPath }, 'ReaderOnly');
  assertPinnedOperationsSnapshot(f);
  for (const value of [pin.manifestPath.toLowerCase(), ' '+pin.manifestPath, pin.manifestPath+'/..',
    pin.manifestPath.replace('/data/', '/data/../data/'), pin.manifestPath.replace('/data/', '/data//'),
    'D:/other/manifest.json', 'relative/manifest.json', '\\\\host\\manifest.json', pin.manifestPath+':alternate']) {
    assert.throws(() => assertEntryRouting({ ...environment(), DATA_OPERATIONS_MANIFEST_PATH: value }, 'ReaderOnly'));
    assert.throws(() => assertPinnedOperationsSnapshot({ ...fixture(), manifestPath: value }));
  }
});

test('manifest exception cannot be used by Start/OpenExisting/CheckOnly or a missing/false/string reader boundary', () => {
  assert.throws(() => assertEntryRouting({ IX0001_LEADERSHIP_COLLECTION_ENABLED: 'true' }, 'ReaderOnly'), /MANIFEST_REQUIRED/);
  for (const mode of ['Start', 'OpenExisting', 'CheckOnly', '']) {
    assert.throws(() => assertEntryRouting(environment(), mode));
    assert.throws(() => assertPinnedOperationsSnapshot({ ...fixture(), requestedMode: mode }));
  }
  for (const value of [undefined, null, false, 'true', '1', 1]) {
    const f = fixture(); f.configuration.candidateReadOnly = value;
    assert.throws(() => assertPinnedOperationsSnapshot(f));
  }
  const f = fixture(); f.configuration.appRoot = 'D:/other/candidate';
  assert.throws(() => assertPinnedOperationsSnapshot(f));
});

test('unknown manifest SHA and all pinned roots/identity fields fail closed', () => {
  const changes = [
    f => { f.binding.manifestSha256 = '0'.repeat(64); },
    f => { f.binding.manifest.governanceState = 'CANDIDATE'; },
    f => { f.binding.manifest.governanceReference = 'unapproved'; },
    f => { f.binding.manifest.selection = 'OTHER'; },
    f => { f.binding.manifest.sourceBindings.batchEvidencePath = 'D:/other.json'; },
    f => { f.binding.manifest.sourceBindings.derivedArtifactPaths.push('D:/other.json'); },
    f => { f.binding.manifest.sourceBindings.sessionsByCheckpoint.EOD_CHECKPOINT = ['DAY']; },
    f => { f.binding.manifest.calendarSha256 = '0'.repeat(64); },
    f => { f.binding.calendar.fileHash = '0'.repeat(64); },
    f => { f.candidateCalendarHash = '0'.repeat(64); },
    f => { f.registryHash = '0'.repeat(64); },
  ];
  for (const key of ['dataRoot', 'outputRoot', 'calendarPath', 'evidenceRoot']) changes.push(f => { f.binding[key] = 'D:/other'; });
  for (const key of ['activeAppRoot', 'ledgerDataRoot', 'databasePath', 'dailyStatusPath', 'registryPath']) changes.push(f => { f.binding.manifest.sourceBindings[key] = 'D:/other'; });
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => assertPinnedOperationsSnapshot(f)); }
});

test('each physical no-link/alias refusal propagates without accepting a prefix or alternate route', () => {
  const expected = fixture(); assertPinnedOperationsSnapshot(expected);
  for (const blockedPath of expected.checked) {
    const f = fixture();
    f.assertNoLinks = path => { if (path === blockedPath) throw Error('SYNTHETIC_ALIAS_REJECTED'); };
    assert.throws(() => assertPinnedOperationsSnapshot(f), /SYNTHETIC_ALIAS_REJECTED/);
  }
});

test('all four other diagnosed routing keys remain rejected when nonempty', () => {
  for (const key of ['V2_RESEARCH_DATABASE_PATH', 'V2_BACKTEST_REPORT_PATH', 'DATA_OPERATIONS_OUTPUT_ROOT', 'V2_DATABASE_PATH']) {
    assert.throws(() => assertEntryRouting({ ...environment(), [key]: 'D:/other' }, 'ReaderOnly'));
  }
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CRU55_RUNTIME_BINDING',
    'CRU54_TEST', 'DASHBOARD_TLS_PFX_PATH', 'DASHBOARD_FORMAL_READ_ROOT', 'PYTHONPATH', 'CVD_TEST', 'TXO_TEST', 'FORWARD_SHADOW_TEST']) {
    assert.throws(() => assertEntryRouting({ ...environment(), [key]: 'nonempty' }, 'ReaderOnly'));
  }
  assert.throws(() => assertEntryRouting({ ...environment(), NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'ReaderOnly'));
  assert.throws(() => assertEntryRouting({ ...environment(), IX0001_LEADERSHIP_COLLECTION_ENABLED: 'false' }, 'ReaderOnly'));
  assert.throws(() => assertEntryRouting({ IX0001_LEADERSHIP_COLLECTION_ENABLED: 'true', data_operations_manifest_path: pin.manifestPath }, 'ReaderOnly'));
});

test('runtime source verifies immutable bytes before validating referenced paths and requires actual config boundary', () => {
  const runtime = source.slice(end, source.indexOf("'@", end));
  assert.ok(runtime.indexOf('configuration.candidateReadOnly !== true') < runtime.indexOf('const manifestBytes ='));
  assert.ok(runtime.indexOf('sha256(manifestBytes) !== OPERATIONS_PIN.manifestSha256') < runtime.indexOf('const binding = validateOperationsBinding('));
  assert.match(runtime, /validateOperationsBinding\(environment\.DATA_OPERATIONS_MANIFEST_PATH, manifestBytes\)/);
  assert.match(runtime, /readBoundedFile\(environment\.DATA_OPERATIONS_MANIFEST_PATH, 1024 \* 1024\)/);
  assert.equal(/console\.|JSON\.stringify\(environment|process\.stdout\.write\((?!'CONFIG_PASS')/.test(runtime), false);
  assert.match(source, /Assert-DailyCleanEnvironment \$b \$RequestedMode/);
  assert.match(source, /Assert-DailyNodeConfiguration \$b \$RequestedMode/);
  assert.match(source, /-RequireReadOnly:\(\$RequestedMode -eq 'ReaderOnly'\)/);
});

test('all ReaderOnly acceptance paths require actual process health binding identity, including warm reuse', () => {
  const guard = source.slice(source.indexOf('function Assert-DailyCandidate('), source.indexOf('function Assert-DailyNoUnownedRuntime('));
  assert.match(guard, /if\(\$RequireReadOnly\)/);
  assert.match(guard, /\$Health\.dataOperationsReader/);
  assert.match(guard, /data-operations-reader-identity-v1/);
  assert.match(guard, /\$reader\.state -ceq 'VALIDATED'/);
  assert.ok(guard.includes(`$reader.bindingIdentity.manifestSha256 -ceq '${pin.manifestSha256}'`));
  assert.ok(guard.includes(`$reader.bindingIdentity.calendarSha256 -ceq '${pin.calendarSha256}'`));
  assert.match(guard, /Assert-Daily \$readerKnown 'CANDIDATE_OPERATIONS_BINDING_UNVERIFIED'/);
  assert.equal((source.match(/Assert-DailyCandidate[^\r\n]+-RequireReadOnly:\(\$RequestedMode -eq 'ReaderOnly'\)/g) || []).length, 3);
});

test('V2 opt-in is exact, ReaderOnly-only, and required in actual resolved configuration', () => {
  for (const value of [undefined, '', null, false, true, 'governed_active_v1', 'OTHER']) {
    assert.throws(() => assertEntryRouting({ ...environment(), DASHBOARD_CANDIDATE_V2_BINDING: value }, 'ReaderOnly'));
    const f = fixture(); f.configuration.candidateV2Binding = value;
    assert.throws(() => assertPinnedOperationsSnapshot(f), /READER_BOUNDARY/);
  }
  for (const mode of ['Start', 'CheckOnly', 'OpenExisting']) {
    assert.throws(() => assertEntryRouting({ IX0001_LEADERSHIP_COLLECTION_ENABLED: 'true', DASHBOARD_CANDIDATE_V2_BINDING: 'GOVERNED_ACTIVE_V1' }, mode));
    assert.doesNotThrow(() => assertEntryRouting({ IX0001_LEADERSHIP_COLLECTION_ENABLED: 'true' }, mode));
  }
  const env = environment(); delete env.DASHBOARD_CANDIDATE_V2_BINDING;
  assert.throws(() => assertEntryRouting({ ...env, dashboard_candidate_v2_binding: 'GOVERNED_ACTIVE_V1' }, 'ReaderOnly'));
});

test('ReaderOnly launch injects only the exact opt-in and actual config checks it before reading the manifest', () => {
  const environmentSource = source.slice(source.indexOf('function Get-DailyEnvironment('), source.indexOf('function Assert-DailyNoEnvPreload('));
  assert.match(environmentSource, /if\(\$RequestedMode -eq 'ReaderOnly'\)\{[^\r\n]+\$map\.DASHBOARD_CANDIDATE_V2_BINDING='GOVERNED_ACTIVE_V1'/);
  assert.doesNotMatch(environmentSource, /V2_DATABASE_PATH|V2_RESEARCH_DATABASE_PATH|V2_BACKTEST_REPORT_PATH/);
  const runtime = source.slice(end, source.indexOf("'@", end));
  assert.ok(runtime.indexOf("configuration.candidateV2Binding !== 'GOVERNED_ACTIVE_V1'") >= 0);
  assert.ok(runtime.indexOf("configuration.candidateV2Binding !== 'GOVERNED_ACTIVE_V1'") < runtime.indexOf('const manifestBytes ='));
});

test('warm, cold and final ReaderOnly acceptance also attest actual V2 identity without requiring missing artifacts', () => {
  const guard = source.slice(source.indexOf('function Assert-DailyCandidate('), source.indexOf('function Assert-DailyNoUnownedRuntime('));
  assert.match(guard, /\$Health\.v2Reader/);
  for (const value of ['v2-reader-identity-v1', 'GOVERNED_ACTIVE_V1', 'GOVERNED_ACTIVE_APP', pin.manifestSha256, pin.calendarSha256])
    assert.ok(guard.includes(value));
  assert.match(guard, /\$v2Reader\.state -ceq 'VALIDATED'/);
  assert.match(guard, /Assert-Daily \$v2ReaderKnown 'CANDIDATE_V2_BINDING_UNVERIFIED'/);
  assert.doesNotMatch(guard, /\.artifacts|\.modifiedAt|\.sizeBytes|PRESENT/);
});

