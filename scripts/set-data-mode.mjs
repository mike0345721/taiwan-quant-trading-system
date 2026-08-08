import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const mode = String(process.argv[2] || '').toLowerCase();
if (!['live', 'mock'].includes(mode)) throw new Error('Usage: node scripts/set-data-mode.mjs live|mock');
if (!fs.existsSync(envPath)) throw new Error('Missing .env. Run 1_SETUP.bat first.');

const current = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
const value = mode === 'live' ? '0' : '1';
const next = /^MOCK_DATA=.*$/m.test(current)
  ? current.replace(/^MOCK_DATA=.*$/m, `MOCK_DATA=${value}`)
  : `${current.replace(/\s*$/, '')}\r\nMOCK_DATA=${value}\r\n`;
const temp = `${envPath}.${process.pid}.tmp`;
fs.writeFileSync(temp, next, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temp, envPath);
console.log(`Dashboard data mode: ${mode.toUpperCase()}`);

