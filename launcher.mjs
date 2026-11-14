import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = process.env.DASHBOARD_ENV_PATH
  ? path.resolve(process.env.DASHBOARD_ENV_PATH)
  : path.join(root, '.env');

if (!fs.existsSync(envPath)) {
  console.error('找不到 .env。請先執行 node scripts/windows-setup.mjs。');
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

// Dashboard launches never imply a new broker login. A timed-out existing
// process must not be duplicated; explicit broker startup uses its own gate.
await import('./server.mjs');
