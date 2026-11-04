import fs from 'node:fs';
import path from 'node:path';
import { readBoundedFile, sha256, noLinks } from './daily-data-operations-files.mjs';
import { validateOperationsBinding } from './data-operations-binding.mjs';

export const V2_READER_MODE = 'GOVERNED_ACTIVE_V1';
export const V2_READER_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const V2_READER_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const V2_READER_PIN = Object.freeze({
  manifestPath: 'D:/Taiwan stock/approved-main-runtime/data/data-operations-binding-r1-8557124-20260928.json',
  manifestSha256: 'b9577adc91155c490f0c3845ba387ca410e90e2110a321a27c3e11ab193bbb1b',
  calendarSha256: '77e3703b470288d8018dffc5dbfd4b33bd0661efc5a9c02a3d9ef8c3a952bb21',
  activeRoot: 'D:/Taiwan stock/standalone-v1',
});
export const V2_READER_ROLES = Object.freeze({
  primaryReport: 'v2/reports/latest-backtest.json',
  basisTerm: 'v2/reports/basis-term-structure-research.json',
  noTrade: 'v2/reports/no-trade-veto.json',
  holding: 'v2/reports/holding-selector.json',
  paired: 'v2/reports/paired-incremental.json',
  v3ForwardStatus: 'v2/reports/v3-forward-status.json',
  oiAudit: 'v2/reports/oi-normalization-audit.json',
  v34ForwardStatus: 'v2/reports/v3.4-forward-status.json',
  foreignRisk: 'v2/reports/foreign-risk-group-v3.4.json',
  extendedFactor: 'v2/reports/v3-6-2-extended-factor-research.json',
  crossMarket: 'v2/reports/v3-6-2-cross-market-research.json',
  collectionAudit: 'v2/reports/v3-6-2-collection-audit.json',
  dailyUpdateStatus: 'v2/reports/v3-daily-update-status.json',
  forwardLedger: 'v2/data/forward/paper-ledger-v2.9.4.jsonl',
});
const exactPath = (a, b) => typeof a === 'string' && a.replaceAll('\\', '/') === b;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const unknown = code => ({ state: 'UNKNOWN', value: null, reasonCodes: [code] });
export const newV2ReadBudget = () => ({ remainingBytes: V2_READER_MAX_PAYLOAD_BYTES });

// Injected dependencies are only for isolated synthetic tests. Production uses
// the existing bounded, link-rejecting reader and never invokes a V2 writer.
export function createGovernedV2Reader(options, dependencies = {}) {
  if (!options.mode) return null;
  const io = { readBoundedFile, sha256, noLinks, validateOperationsBinding, statSync: fs.statSync, ...dependencies };
  let validated = false;
  const paths = Object.fromEntries(Object.entries(V2_READER_ROLES).map(([role, relative]) => [role, path.join(V2_READER_PIN.activeRoot, relative)]));
  paths.database = path.join(V2_READER_PIN.activeRoot, 'v2/data/research-v2.sqlite');
  try {
    if (options.mode !== V2_READER_MODE || options.candidateReadOnly !== true) fail('V2_READER_BOUNDARY_INVALID');
    if (Object.values(options.overrides || {}).some(value => value)) fail('V2_READER_OVERRIDE_REJECTED');
    if (!exactPath(options.manifestPath, V2_READER_PIN.manifestPath)) fail('V2_READER_MANIFEST_UNVERIFIED');
    const bytes = io.readBoundedFile(options.manifestPath, 1024 * 1024);
    // No document reference is followed before immutable bytes are authenticated.
    if (io.sha256(bytes) !== V2_READER_PIN.manifestSha256) fail('V2_READER_MANIFEST_UNVERIFIED');
    const binding = io.validateOperationsBinding(options.manifestPath, bytes);
    if (binding.manifestSha256 !== V2_READER_PIN.manifestSha256
      || binding.manifest?.calendarSha256 !== V2_READER_PIN.calendarSha256
      || binding.calendar?.fileHash !== V2_READER_PIN.calendarSha256
      || options.calendar?.fileHash !== V2_READER_PIN.calendarSha256
      || !exactPath(binding.manifest?.sourceBindings?.activeAppRoot, V2_READER_PIN.activeRoot)
      || !exactPath(binding.manifest?.sourceBindings?.databasePath, V2_READER_PIN.activeRoot + '/v2/data/research-v2.sqlite')
      || !exactPath(binding.manifest?.sourceBindings?.dailyStatusPath, V2_READER_PIN.activeRoot + '/v2/reports/v3-daily-update-status.json')) fail('V2_READER_BINDING_UNVERIFIED');
    for (const file of Object.values(paths)) io.noLinks(file);
    validated = true;
  } catch { /* Remain explicitly unavailable, with no candidate-root fallback. */ }

  function metadata(role) {
    if (!validated || !Object.hasOwn(paths, role)) return { state: 'UNVERIFIED' };
    try {
      io.noLinks(paths[role]);
      const stat = io.statSync(paths[role]);
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) return { state: 'UNVERIFIED' };
      return { state: role !== 'database' && stat.size > V2_READER_MAX_FILE_BYTES ? 'OVERSIZE' : 'PRESENT',
        sizeBytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() };
    } catch (error) { return { state: error.code === 'ENOENT' ? 'MISSING' : 'UNVERIFIED' }; }
  }
  return Object.freeze({
    validated,
    paths: Object.freeze(paths),
    identity() {
      if (!validated) return { schemaVersion: 'v2-reader-identity-v1', state: 'UNVERIFIED', reasonCodes: ['V2_READER_BINDING_UNVERIFIED'] };
      return { schemaVersion: 'v2-reader-identity-v1', state: 'VALIDATED', bindingKind: V2_READER_MODE,
        sourceRole: 'GOVERNED_ACTIVE_APP', bindingIdentity: { manifestSha256: V2_READER_PIN.manifestSha256, calendarSha256: V2_READER_PIN.calendarSha256 },
        artifacts: Object.fromEntries(Object.keys(paths).map(role => [role, metadata(role)])) };
    },
    databaseAvailable() { const item = metadata('database'); return item.state === 'PRESENT' && item.sizeBytes > 0; },
    read(role, budget = newV2ReadBudget()) {
      if (!validated) return unknown('V2_READER_BINDING_UNVERIFIED');
      if (!Object.hasOwn(V2_READER_ROLES, role)) return unknown('V2_READER_ROLE_UNVERIFIED');
      const item = metadata(role);
      if (item.state !== 'PRESENT') return unknown(`V2_READER_ARTIFACT_${item.state}`);
      if (!Number.isSafeInteger(budget.remainingBytes) || budget.remainingBytes < item.sizeBytes) return unknown('V2_READER_PAYLOAD_BUDGET_EXCEEDED');
      // Charge the reservation even when the bounded reader detects a change
      // after reading. Growth must fail before exceeding this reservation.
      budget.remainingBytes -= item.sizeBytes;
      try {
        const bytes = io.readBoundedFile(paths[role], item.sizeBytes);
        const text = bytes.toString('utf8');
        const value = role === 'forwardLedger'
          ? text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line))
          : JSON.parse(text);
        if (role === 'forwardLedger' ? value.some(row => !row || typeof row !== 'object' || Array.isArray(row))
          : !value || typeof value !== 'object' || Array.isArray(value)) return unknown('V2_READER_ARTIFACT_INVALID');
        return { state: 'READ', value: role === 'forwardLedger' ? value.length : value, reasonCodes: [] };
      } catch { return unknown('V2_READER_ARTIFACT_UNREADABLE'); }
    },
  });
}
