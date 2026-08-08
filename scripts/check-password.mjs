import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from '../src/security.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, '..');
const envPath = path.join(root, '.env');

function loadHash() {
  if (!fs.existsSync(envPath)) throw new Error('.env was not found. Run 1_SETUP.bat first.');
  const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('DASHBOARD_PASSWORD_HASH=')) {
      return line.slice('DASHBOARD_PASSWORD_HASH='.length).trim();
    }
  }
  throw new Error('DASHBOARD_PASSWORD_HASH was not found.');
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Interactive terminal is required.'));
      return;
    }
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const done = () => {
      process.stdin.removeListener('data', onData);
      try { process.stdin.setRawMode(false); } catch {}
      process.stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };

    const onData = (chunk) => {
      for (const char of Array.from(chunk)) {
        if (char === '\u0003') process.exit(130);
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0008' || char === '\u007f') {
          const chars = Array.from(value);
          if (chars.length) {
            chars.pop();
            value = chars.join('');
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          value += char;
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

const hash = loadHash();
let password = await readHidden('Password to check: ');
const valid = verifyPassword(password, hash);
password = '';

console.log(valid ? 'Password check: PASSED' : 'Password check: FAILED');
process.exit(valid ? 0 : 1);
