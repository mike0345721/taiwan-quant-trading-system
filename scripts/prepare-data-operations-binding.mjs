import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile, sha256 } from '../src/daily-data-operations-files.mjs';
import { readOperationsBinding, validateOperationsBinding } from '../src/data-operations-binding.mjs';

// Preparation only: creates a NEW configuration. Does not install tasks, set
// runtime environment, migrate history, or modify the existing input index.
export function prepareOperationsBinding({ sourceManifestPath, targetPath, activeAppRoot, dataRoot, outputRoot,
  evidenceRoot, calendarPath, governanceReference }) {
  for (const value of [sourceManifestPath, targetPath, activeAppRoot, dataRoot, outputRoot, evidenceRoot, calendarPath]) {
    if (!path.isAbsolute(value || '')) throw Error('OPERATIONS_BINDING_ABSOLUTE_PATH_REQUIRED');
  }
  if (!governanceReference) throw Error('OPERATIONS_BINDING_GOVERNANCE_REQUIRED');
  const bytes = readBoundedFile(sourceManifestPath, 1024 * 1024);
  const previous = JSON.parse(bytes.toString('utf8'));
  if (previous.schemaVersion !== 'data-operations-input-index-v1' || previous.governanceState !== 'GOVERNED'
    || previous.selection !== 'BUILD_A1' || !previous.sourceBindings) throw Error('OPERATIONS_BINDING_SOURCE_INVALID');
  const manifest = { ...previous, governanceReference, supersedesManifestSha256: sha256(bytes), evidenceRoot,
    calendarSha256: sha256(readBoundedFile(calendarPath)),
    operationsBinding: { schemaVersion: 'data-operations-binding-v1', dataRoot, outputRoot, calendarPath },
    sourceBindings: { ...previous.sourceBindings, activeAppRoot,
      databasePath: path.join(activeAppRoot, 'v2/data/research-v2.sqlite'),
      dailyStatusPath: path.join(activeAppRoot, 'v2/reports/v3-daily-update-status.json') } };
  const contents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  validateOperationsBinding(targetPath, contents);
  // Exclusive creation prevents replacement of old governance or evidence bytes.
  fs.writeFileSync(targetPath, contents, { flag: 'wx' });
  return readOperationsBinding(targetPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = { source: 'sourceManifestPath', target: 'targetPath', 'active-app-root': 'activeAppRoot',
    'data-root': 'dataRoot', 'output-root': 'outputRoot', 'evidence-root': 'evidenceRoot', calendar: 'calendarPath',
    'governance-reference': 'governanceReference' };
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !keys[match[1]] || Object.hasOwn(args, keys[match[1]])) throw Error('OPERATIONS_ARGUMENT_INVALID');
    args[keys[match[1]]] = match[2];
  }
  const binding = prepareOperationsBinding(args);
  console.log(JSON.stringify({ status: 'PREPARED_NOT_ACTIVATED', manifestSha256: binding.manifestSha256 }));
}
