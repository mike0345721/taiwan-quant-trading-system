import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  createOwnerLaunchApprovalArtifact,
  createReadyForLaunchManifest,
  digest,
  stableJson,
} from '../src/market-state-forward-shadow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const kind = value('--kind');
const outputPath = path.resolve(value('--output') || '');
if (!kind || !value('--output')) throw new Error('FORWARD_SHADOW_PREPARATION_ARGUMENTS_REQUIRED');
if (/^[cC]:[\\/]/.test(outputPath)) throw new Error('FORWARD_SHADOW_C_DRIVE_RUNTIME_FORBIDDEN');

const writeImmutable = (payload) => {
  const body = stableJson(payload);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) {
    if (fs.readFileSync(outputPath, 'utf8') !== body) throw new Error('FORWARD_SHADOW_IMMUTABLE_OUTPUT_CONFLICT');
    return 'UNCHANGED';
  }
  fs.writeFileSync(outputPath, body, { encoding: 'utf8', flag: 'wx' });
  return 'CREATED';
};

let artifact;
if (kind === 'READY_MANIFEST') {
  const hashFile = (relativePath) => digest(fs.readFileSync(path.join(root, relativePath)));
  artifact = createReadyForLaunchManifest({
    finalMainCommit: value('--final-main-commit'),
    officialStartTradeDate: value('--official-start-trade-date'),
    schedulerTime: value('--scheduler-time', '08:25 Asia/Taipei'),
    runtimeRoot: value('--runtime-root'),
    runId: value('--run-id'),
    evaluator: { version: 'market-state-v1-premarket-evaluator-v0', sha256: hashFile('src/market-state-v1.mjs') },
    outcomeContract: { version: 'market-state-outcome-contract-v1', sha256: hashFile('src/market-state-outcome-contract.mjs') },
    linkageContract: { version: 'cru18-single-axis-linkage-v1', sha256: hashFile('src/market-state-outcome-linkage.mjs') },
    frozenForwardGate: { version: 'cru19-owner-frozen-forward-shadow-gate-v1', sha256: hashFile('docs/research/MARKET_STATE_V1_FORWARD_SHADOW_GATE.md') },
    selectedAxes: ['direction', 'globalAlignment'],
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
} else if (kind === 'OWNER_APPROVAL') {
  const manifest = JSON.parse(fs.readFileSync(value('--launch-manifest'), 'utf8'));
  artifact = createOwnerLaunchApprovalArtifact({
    ownerDecisionReference: value('--owner-decision-reference'),
    approvedAt: value('--approved-at'),
    manifestHash: manifest.manifestHash,
    finalMainCommit: manifest.finalMainCommit,
    officialStartTradeDate: manifest.officialStartTradeDate,
    schedulerTime: manifest.schedulerTime,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
} else {
  throw new Error('FORWARD_SHADOW_PREPARATION_KIND_INVALID');
}

const writeStatus = writeImmutable(artifact);
process.stdout.write(stableJson({
  kind,
  outputPath,
  writeStatus,
  artifactHash: kind === 'OWNER_APPROVAL' ? artifact.approvalArtifactHash : artifact.manifestHash,
  launchStatus: artifact.launchStatus || 'OWNER_APPROVAL_ARTIFACT',
  executionAuthorized: false,
}));
