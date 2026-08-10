import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  createLaunchManifestCandidate,
  digest,
  stableJson,
  validateCollectorMode,
} from '../src/market-state-forward-shadow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const mode = value('--mode', 'NOT_ACTIVE');
const outputDir = value('--output-dir');
if (!outputDir) throw new Error('FORWARD_SHADOW_OUTPUT_DIR_REQUIRED');
const collector = validateCollectorMode(mode);
const hashFile = (relativePath) => digest(fs.readFileSync(path.join(root, relativePath)));
const baselineMainCommit = '83666f12daaedc771d49058ce04f8612e948e8cd';
const frozenHashes = Object.freeze({
  evaluator: 'a7285f53006f49ae0cd1613e2798eaca730d83d03eb980d9f5d1e095d6b512b7',
  outcomeContract: 'b5cf8434636aec5a54fdfeaa63754213495aa563f315d09e39bd1dca34580f96',
  linkageContract: '884afd174e6d86d9c525629138c12ae5d67316b3f904013d69e2d813ea66a081',
});
const actualHashes = {
  evaluator: hashFile('src/market-state-v1.mjs'),
  outcomeContract: hashFile('src/market-state-outcome-contract.mjs'),
  linkageContract: hashFile('src/market-state-outcome-linkage.mjs'),
};
for (const [name, expectedHash] of Object.entries(frozenHashes)) {
  if (actualHashes[name] !== expectedHash) throw new Error(`FORWARD_SHADOW_FROZEN_${name.toUpperCase()}_HASH_MISMATCH`);
}
const manifest = createLaunchManifestCandidate({
  baselineMainCommit,
  evaluator: {
    version: 'market-state-v1-premarket-evaluator-v0',
    sha256: actualHashes.evaluator,
  },
  outcomeContract: {
    version: 'market-state-outcome-contract-v1',
    sha256: actualHashes.outcomeContract,
  },
  linkageContract: {
    version: 'cru18-single-axis-linkage-v1',
    sha256: actualHashes.linkageContract,
  },
  frozenForwardGate: {
    version: 'cru19-owner-frozen-forward-shadow-gate-v1',
    sha256: hashFile('docs/research/MARKET_STATE_V1_FORWARD_SHADOW_GATE.md'),
  },
  selectedAxes: ['direction', 'globalAlignment'],
  launchStatus: 'NOT_ACTIVE',
  candidateStartTradeDate: null,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
});

fs.mkdirSync(path.resolve(outputDir), { recursive: true });
const candidatePath = path.join(path.resolve(outputDir), 'launch-manifest-candidate.json');
const readinessPath = path.join(path.resolve(outputDir), 'launch-preflight.json');
const writeImmutable = (targetPath, content) => {
  if (fs.existsSync(targetPath)) {
    if (fs.readFileSync(targetPath, 'utf8') !== content) throw new Error('FORWARD_SHADOW_IMMUTABLE_OUTPUT_CONFLICT');
    return 'UNCHANGED';
  }
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporaryPath, targetPath);
  return 'CREATED';
};
const manifestWriteStatus = writeImmutable(candidatePath, stableJson(manifest));
const readiness = {
  schemaVersion: 'market-state-forward-shadow-launch-preflight-v1',
  status: 'READY_FOR_OWNER_LAUNCH_REVIEW',
  collector,
  scheduler: { mode: 'NOT_ACTIVE', installed: false, enabled: false },
  manifestHash: manifest.manifestHash,
  officialEvidenceWritten: false,
  candidateStartTradeDate: null,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
const readinessWriteStatus = writeImmutable(readinessPath, stableJson(readiness));
process.stdout.write(stableJson({ candidatePath, readinessPath, manifestWriteStatus, readinessWriteStatus, ...readiness }));
