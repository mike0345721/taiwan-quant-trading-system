import fs from 'node:fs';
import path from 'node:path';
import { digest, stableJson } from './market-state-forward-shadow.mjs';

const ROOT_FILES = Object.freeze(['launch-manifest.json', 'official-ledger.ndjson']);
const ROOT_DIRECTORIES = Object.freeze(['official-records', 'checksums', 'daily-status', 'logs']);

function ensureDDrive(value, code) {
  const resolved = path.resolve(value || '');
  if (!/^[dD]:[\\/]/.test(resolved)) throw new Error(code);
  return resolved;
}

function filesUnder(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function immutableCopy(source, target, { appendOnly = false } = {}) {
  const bytes = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target);
    if (existing.equals(bytes)) return { status: 'UNCHANGED', hash: digest(bytes), bytes: bytes.length };
    if (appendOnly && bytes.subarray(0, existing.length).equals(existing)) {
      fs.appendFileSync(target, bytes.subarray(existing.length));
      if (!fs.readFileSync(target).equals(bytes)) throw new Error(`FORWARD_SHADOW_BACKUP_CHECKSUM_MISMATCH:${target}`);
      return { status: 'APPENDED', hash: digest(bytes), bytes: bytes.length };
    }
    throw new Error(`FORWARD_SHADOW_BACKUP_CONFLICT:${target}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
  const copied = fs.readFileSync(target);
  if (!copied.equals(bytes)) throw new Error(`FORWARD_SHADOW_BACKUP_CHECKSUM_MISMATCH:${target}`);
  return { status: 'COPIED', hash: digest(bytes), bytes: bytes.length };
}

export function replicateOperationalSecondCopy({ primaryRunRoot, backupRoot, runId }) {
  const primary = ensureDDrive(primaryRunRoot, 'FORWARD_SHADOW_PRIMARY_BACKUP_SOURCE_MUST_BE_D_DRIVE');
  const secondaryRoot = ensureDDrive(backupRoot, 'FORWARD_SHADOW_SECONDARY_BACKUP_MUST_BE_D_DRIVE');
  const secondary = path.join(secondaryRoot, runId);
  if (path.resolve(primary).toLowerCase() === path.resolve(secondary).toLowerCase()) throw new Error('FORWARD_SHADOW_BACKUP_MUST_BE_SEPARATE_PATH');
  const sources = [];
  for (const name of ROOT_FILES) {
    const source = path.join(primary, name);
    if (fs.existsSync(source)) sources.push(source);
  }
  for (const directory of ROOT_DIRECTORIES) {
    const files = filesUnder(path.join(primary, directory));
    sources.push(...files.filter((file) => !['checksums', 'daily-status'].includes(directory)
      || path.basename(file).startsWith('official_forward-')));
  }
  if (!sources.some((file) => path.basename(file) === 'launch-manifest.json')) throw new Error('FORWARD_SHADOW_BACKUP_LAUNCH_MANIFEST_MISSING');
  const results = sources.sort().map((source) => {
    const relative = path.relative(primary, source);
    return { relativePath: relative.replaceAll('\\', '/'), ...immutableCopy(source, path.join(secondary, relative), { appendOnly: relative.replaceAll('\\', '/') === 'official-ledger.ndjson' }) };
  });
  return Object.freeze({
    status: 'PASS',
    backupRoot: secondary,
    fileCount: results.length,
    copiedCount: results.filter((item) => item.status === 'COPIED').length,
    appendedCount: results.filter((item) => item.status === 'APPENDED').length,
    unchangedCount: results.filter((item) => item.status === 'UNCHANGED').length,
    checksumParity: true,
    immutable: true,
    results,
    backupManifestHash: digest(results),
    executionAuthorized: false,
  });
}

export function writeImmutableLaunchManifest(primaryRunRoot, launchManifest) {
  const target = path.join(primaryRunRoot, 'launch-manifest.json');
  const body = stableJson(launchManifest);
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target, 'utf8') !== body) throw new Error('FORWARD_SHADOW_PRIMARY_LAUNCH_MANIFEST_CONFLICT');
    return target;
  }
  fs.writeFileSync(target, body, { encoding: 'utf8', flag: 'wx' });
  return target;
}
