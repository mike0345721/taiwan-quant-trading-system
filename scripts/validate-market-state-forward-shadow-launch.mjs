import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, stableJson } from '../src/market-state-forward-shadow.mjs';
import { runtimePaths, validateOfficialLaunchContext } from '../src/market-state-forward-shadow-runtime.mjs';

const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const manifestPath = value('--launch-manifest');
const approvalPath = value('--owner-approval');
if (!manifestPath || !approvalPath) throw new Error('FORWARD_SHADOW_GOVERNANCE_ARTIFACTS_REQUIRED');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const ownerApprovalArtifact = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
const runtimeRoot = path.dirname(launchManifest.runtimeRoot);
const actualArtifactHashes = {
  evaluator: digest(fs.readFileSync(path.join(root, 'src/market-state-v1.mjs'))),
  outcomeContract: digest(fs.readFileSync(path.join(root, 'src/market-state-outcome-contract.mjs'))),
  linkageContract: digest(fs.readFileSync(path.join(root, 'src/market-state-outcome-linkage.mjs'))),
  frozenForwardGate: digest(fs.readFileSync(path.join(root, 'docs/research/MARKET_STATE_V1_FORWARD_SHADOW_GATE.md'))),
};
const validation = validateOfficialLaunchContext({
  runtimeRoot,
  runId: launchManifest.runId,
  tradeDate: launchManifest.officialStartTradeDate,
  launchManifest,
  ownerApprovalArtifact,
  currentMainCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  actualArtifactHashes,
}, runtimePaths(runtimeRoot, launchManifest.runId));
process.stdout.write(stableJson({
  status: 'PASS',
  manifestHash: validation.manifestHash,
  approvalArtifactHash: validation.approvalArtifactHash,
  officialMode: 'FORWARD_SHADOW',
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
}));
