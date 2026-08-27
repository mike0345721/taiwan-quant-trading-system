import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectProjectStatus } from './project-status.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputRoot = path.join(root, 'data', 'diagnostics');
const outputPath = path.join(outputRoot, 'latest.json');

const report = Object.freeze({
  schemaVersion: 'development-diagnostics-v1',
  generatedAt: new Date().toISOString(),
  purpose: 'Share bounded local runtime evidence with ChatGPT/Codex without copying credentials or raw market data.',
  collectionPolicy: Object.freeze({
    allowlistOnly: true,
    readsEnvironmentSecrets: false,
    readsCredentialFiles: false,
    readsRawLedgerBody: false,
    readsDatabaseContentBeyondGovernedProjectStatusProbe: false,
    includesLargeArtifacts: false,
  }),
  host: Object.freeze({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  }),
  projectStatus: await collectProjectStatus({ root }),
  safety: Object.freeze({
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  }),
});

fs.mkdirSync(outputRoot, { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temporary, outputPath);

process.stdout.write(`Diagnostics written to ${path.relative(root, outputPath)}\n`);
process.stdout.write('This artifact is local-only and intentionally excludes credentials, .env files, SQLite contents, and raw/live-event bodies.\n');
