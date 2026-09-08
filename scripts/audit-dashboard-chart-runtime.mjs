import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const rootPackagePath = path.join(root, 'package.json');
const installedPackagePath = path.join(root, 'node_modules', 'lightweight-charts', 'package.json');
const standalonePath = path.join(
  root,
  'node_modules',
  'lightweight-charts',
  'dist',
  'lightweight-charts.standalone.production.js',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const rootPackage = readJson(rootPackagePath);
const expectedVersion = String(rootPackage.dependencies?.['lightweight-charts'] || '').trim() || null;
const installedExists = fs.existsSync(installedPackagePath);
const installedPackage = installedExists ? readJson(installedPackagePath) : null;
const installedVersion = installedPackage?.version || null;
const standaloneExists = fs.existsSync(standalonePath);
const standaloneBytes = standaloneExists ? fs.statSync(standalonePath).size : null;
const versionMatches = Boolean(expectedVersion && installedVersion && expectedVersion === installedVersion);
const ready = installedExists && standaloneExists && versionMatches;

const report = {
  schemaVersion: 'cru45-chart-runtime-audit-v1',
  expectedVersion,
  installedVersion,
  versionMatches,
  installedPackageExists: installedExists,
  standaloneBundleExists: standaloneExists,
  standaloneBundleBytes: standaloneBytes,
  servedPath: '/vendor/lightweight-charts.js',
  serverSource: 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js',
  ready,
  nextCheck: ready
    ? 'Open the real Dashboard and verify LightweightCharts v5 API, candle data length, canvas dimensions, and visible logical range.'
    : 'Run npm ci from the repository root, then rerun this audit before browser diagnosis.',
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!ready) process.exitCode = 2;
