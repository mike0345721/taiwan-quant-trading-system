import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.env.DASHBOARD_ENV_PATH
  ? path.resolve(process.env.DASHBOARD_ENV_PATH)
  : path.join(root, '.env');
const shioajiEnvPath = path.join(root, '.shioaji.credentials.json');

if (!fs.existsSync(envPath)) {
  console.error('找不到 .env。請先雙擊 1_SETUP.bat。');
  process.exit(1);
}

const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
for (const rawLine of text.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 1) continue;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (process.env[key] == null) process.env[key] = value;
}

let quoteBridge = null;
async function bridgeIsReady() {
  try {
    const response = await fetch('http://127.0.0.1:8790/health', { signal: AbortSignal.timeout(800) });
    const status = await response.json();
    return response.ok
      && status?.mode === 'market_data_only'
      && status?.executionAuthorized === false
      && status?.orderRoutesEnabled === false;
  } catch {
    return false;
  }
}

if (fs.existsSync(shioajiEnvPath) && !(await bridgeIsReady())) {
  quoteBridge = spawn('python', [path.join(root, 'broker', 'shioaji_readonly_bridge.py')], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  quoteBridge.once('error', (error) => {
    console.error(`Shioaji read-only bridge could not start: ${error.message}`);
  });
}

function stopBridge() {
  if (quoteBridge && !quoteBridge.killed) quoteBridge.kill('SIGTERM');
}
process.once('SIGINT', stopBridge);
process.once('SIGTERM', stopBridge);
process.once('exit', stopBridge);

await import('./server.mjs');
