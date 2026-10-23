import path from 'node:path';
import { readBoundedFile, sha256, noLinks, assertOperationsOutputRoot } from './daily-data-operations-files.mjs';
import { assertDailyAcceptanceOutputRoot } from './daily-collection-acceptance-sweep.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';

const fail = code => { throw new Error(`OPERATIONS_BINDING_${code}`); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a) === path.resolve(b);

// One explicitly selected, immutable configuration for both the writer and reader.
// No discovery, newest-file fallback, migration of history, or source data writes.
export function readOperationsBinding(manifestPath) {
  if (!path.isAbsolute(manifestPath || '')) fail('ABSOLUTE_PATH_REQUIRED');
  const bytes = readBoundedFile(manifestPath, 1024 * 1024);
  return validateOperationsBinding(manifestPath, bytes);
}

export function validateOperationsBinding(manifestPath, bytes) {
  if (!path.isAbsolute(manifestPath || '')) fail('ABSOLUTE_PATH_REQUIRED');
  noLinks(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  const binding = manifest.operationsBinding;
  if (manifest.schemaVersion !== 'data-operations-input-index-v1' || manifest.governanceState !== 'GOVERNED'
    || !manifest.governanceReference || binding?.schemaVersion !== 'data-operations-binding-v1') fail('INVALID');
  for (const key of ['dataRoot', 'outputRoot', 'calendarPath']) {
    if (!path.isAbsolute(binding[key] || '')) fail('ABSOLUTE_PATH_REQUIRED');
    noLinks(binding[key]);
  }
  if (!path.isAbsolute(manifest.evidenceRoot || '')) fail('ABSOLUTE_PATH_REQUIRED');
  assertOperationsOutputRoot(binding.dataRoot, binding.outputRoot, [manifestPath, manifest.evidenceRoot, binding.calendarPath]);
  assertDailyAcceptanceOutputRoot(binding.dataRoot, manifest.evidenceRoot, [manifestPath, binding.calendarPath]);
  const calendarBytes = readBoundedFile(binding.calendarPath);
  if (sha256(calendarBytes) !== manifest.calendarSha256) fail('CALENDAR_MISMATCH');
  const calendar = loadGovernedTradingCalendar(binding.calendarPath);
  if (manifest.selection === 'BUILD_A1') {
    const sources = manifest.sourceBindings;
    if (!path.isAbsolute(sources?.activeAppRoot || '')) fail('ACTIVE_SOURCE_REQUIRED');
    noLinks(sources.activeAppRoot);
    if (!same(sources.databasePath, path.join(sources.activeAppRoot, 'v2/data/research-v2.sqlite'))
      || !same(sources.dailyStatusPath, path.join(sources.activeAppRoot, 'v2/reports/v3-daily-update-status.json'))
      || sources.batchEvidencePath) fail('ACTIVE_SOURCE_MISMATCH');
    noLinks(sources.databasePath);
    noLinks(sources.dailyStatusPath);
  }
  return { manifest, manifestSha256: sha256(bytes), dataRoot: binding.dataRoot, outputRoot: binding.outputRoot,
    evidenceRoot: manifest.evidenceRoot, calendarPath: binding.calendarPath, calendar };
}

export function assertOperationsBindingLaunch(options) {
  // Existing frozen v1 input indexes remain replayable without rewriting them.
  const manifest = JSON.parse(readBoundedFile(options.manifestPath, 1024 * 1024).toString('utf8'));
  if (!manifest.operationsBinding) return null;
  const binding = readOperationsBinding(options.manifestPath);
  for (const key of ['dataRoot', 'outputRoot', 'evidenceRoot', 'calendarPath']) {
    if (!same(options[key], binding[key])) fail('LAUNCH_MISMATCH');
  }
  return binding;
}

export function assertOperationsBindingRoots(options) {
  let manifest;
  try { manifest = JSON.parse(readBoundedFile(options.manifestPath, 1024 * 1024).toString('utf8')); }
  catch { return; } // Record unreadable/invalid input inside the guarded job lifecycle.
  if (!manifest?.operationsBinding) return;
  for (const key of ['dataRoot', 'outputRoot', 'calendarPath']) {
    if (!same(options[key], manifest.operationsBinding[key])) fail('LAUNCH_MISMATCH');
  }
  if (!same(options.evidenceRoot, manifest.evidenceRoot)) fail('LAUNCH_MISMATCH');
}

export function resolveOperationsReader({ manifestPath, dataRoot, outputRoot, calendar }) {
  if (!manifestPath) return { dataRoot, outputRoot: outputRoot || path.join(dataRoot, 'quality/daily-data-operations'), calendar };
  const binding = readOperationsBinding(manifestPath);
  if (outputRoot && !same(outputRoot, binding.outputRoot)) fail('READER_OVERRIDE_MISMATCH');
  if (calendar && calendar.fileHash !== binding.calendar.fileHash) fail('OPERATING_CALENDAR_BASE_MISMATCH');
  return { dataRoot: binding.dataRoot, outputRoot: binding.outputRoot, calendar: calendar === undefined ? binding.calendar : calendar,
    bindingIdentity: { manifestSha256: binding.manifestSha256, calendarSha256: binding.manifest.calendarSha256 } };
}
