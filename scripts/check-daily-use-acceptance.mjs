import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readBoundedFile, sha256, contained } from '../src/daily-data-operations-files.mjs';
import { validateOperationsBinding } from '../src/data-operations-binding.mjs';
import { readDataOperations } from '../src/dashboard-data-operations.mjs';
import { V2_READER_PIN } from '../src/dashboard-v2-reader-binding.mjs';
import { buildDailyUseReceipt, writeDailyUseReceipt } from '../src/daily-use-acceptance.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
// Invoked through the existing runner's explicit readonly mode. Never runs A.1,
// scans ledger/SQLite, contacts brokers, controls services or installs a schedule.
export function checkDailyUse(options) {
  const allowed = ['dailyUse', 'candidateSha', 'tradeDate', 'session', 'observationsPath'];
  if (options.dailyUse !== 'true' || Object.keys(options).some(k => !allowed.includes(k))) throw new Error('DAILY_USE_ARGUMENT_INVALID');
  const candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, windowsHide: true, encoding: 'utf8' }).trim();
  if (candidateSha !== options.candidateSha) throw new Error('DAILY_USE_CHECKOUT_MISMATCH');
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: appRoot, windowsHide: true, encoding: 'utf8' }).trim())
    throw new Error('DAILY_USE_WORKTREE_DIRTY');
  const bindingBytes = readBoundedFile(V2_READER_PIN.manifestPath, 1024 * 1024);
  if (sha256(bindingBytes) !== V2_READER_PIN.manifestSha256) throw new Error('DAILY_USE_BINDING_MISMATCH');
  const binding = validateOperationsBinding(V2_READER_PIN.manifestPath, bindingBytes);
  const batchBytes = readBoundedFile(binding.manifest.sourceBindings.dailyStatusPath, 256 * 1024);
  const batch = JSON.parse(batchBytes);
  const now = new Date();
  const operations = readDataOperations({ ...binding, now });
  const evidence = [{ role: 'OPERATIONS_BINDING', sha256: sha256(bindingBytes) },
    { role: 'DAILY_BATCH', sha256: sha256(batchBytes) }, { role: 'OPERATIONS_VIEW', sha256: sha256(JSON.stringify(operations)) }];
  let observations = null;
  if (options.observationsPath) {
    const root = path.join(appRoot, 'data/quality/daily-use-evidence');
    const file = path.resolve(options.observationsPath);
    if (!contained(root, file) || path.extname(file) !== '.json') throw new Error('DAILY_USE_EVIDENCE_ROOT_INVALID');
    const bytes = readBoundedFile(file, 128 * 1024); observations = JSON.parse(bytes);
    evidence.push({ role: 'OBSERVATIONS', sha256: sha256(bytes) });
    const refs = observations.evidence || [];
    if (!Array.isArray(refs) || refs.length > 16) throw new Error('DAILY_USE_EVIDENCE_LIMIT');
    let total = bytes.length;
    for (const ref of refs) {
      if (!/^[a-zA-Z0-9_-]+\.(json|txt|png)$/.test(ref.file || '')) throw new Error('DAILY_USE_REFERENCE_INVALID');
      const b = readBoundedFile(path.join(path.dirname(file), ref.file), 256 * 1024); total += b.length;
      if (total > 1024 * 1024 || sha256(b) !== ref.sha256) throw new Error('DAILY_USE_EVIDENCE_HASH_OR_BUDGET');
      evidence.push({ role: 'OBSERVED_ARTIFACT', sha256: ref.sha256 });
    }
  }
  const receipt = buildDailyUseReceipt({ candidateSha, now, tradeDate: options.tradeDate ?? null,
    session: options.session ?? 'UNKNOWN', operations, batch, observations, evidence });
  const dataRoot = path.join(appRoot, 'data');
  const outputRoot = path.join(dataRoot, 'quality/daily-data-operations/daily-use-checks');
  const saved = writeDailyUseReceipt({ dataRoot, outputRoot, receipt });
  return { ...saved, overall: receipt.overall, dailyBatch: receipt.dailyBatch.state,
    candidateSha, observedAt: receipt.observedAt, automaticActivation: receipt.automaticActivation };
}
