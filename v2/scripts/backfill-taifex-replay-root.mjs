import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..', '..');
const scriptPath = path.join(appRoot, 'scripts', 'backfill-taifex-replay.ps1');
const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const delayMs = process.env.V3_INTRADAY_BACKFILL_DELAY_MS || '3000';

const result = spawnSync(shell, [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', scriptPath,
  '-Limit', '30',
  '-DelayMs', delayMs,
], {
  cwd: appRoot,
  env: { ...process.env },
  encoding: 'utf8',
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

