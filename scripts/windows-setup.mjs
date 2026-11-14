import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from '../src/security.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, '..');
const envPath = path.join(root, '.env');

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Interactive terminal is required.'));
      return;
    }

    let value = '';
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();

    const finish = () => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
      stdout.write('\n');
      resolve(value);
    };

    const fail = (error) => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
      stdout.write('\n');
      reject(error);
    };

    const onData = (chunk) => {
      for (const char of Array.from(chunk)) {
        if (char === '\u0003') {
          fail(new Error('Setup cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u0008' || char === '\u007f') {
          const chars = Array.from(value);
          if (chars.length > 0) {
            chars.pop();
            value = chars.join('');
            stdout.write('\b \b');
          }
          continue;
        }
        if (char >= ' ') {
          value += char;
          stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

console.log('');
console.log('Create a password for the dashboard.');
console.log('Use at least 12 characters. Chinese and special characters are supported.');
console.log('Your input will be hidden.');

let password = '';
while (true) {
  const first = await readHidden('New password: ');
  const second = await readHidden('Enter the password again: ');

  if (first.length < 12) {
    console.log('Password is too short. Use at least 12 characters.');
    continue;
  }
  if (first !== second) {
    console.log('The passwords do not match. Please try again.');
    continue;
  }
  password = first;
  break;
}

const passwordHash = hashPassword(password);
if (!verifyPassword(password, passwordHash)) {
  throw new Error('Password self-check failed. No settings were changed.');
}

const envText = [
  'HOST=127.0.0.1',
  'PORT=8787',
  'NODE_ENV=production',
  `DASHBOARD_PASSWORD_HASH=${passwordHash}`,
  'SESSION_TTL_MINUTES=480',
  'REFRESH_INTERVAL_SECONDS=300',
  'UPSTREAM_TIMEOUT_MS=12000',
  'TRUST_PROXY=0',
  'COOKIE_SECURE=0',
  'MOCK_DATA=1',
  '',
].join('\r\n');

fs.writeFileSync(envPath, envText, { encoding: 'utf8', mode: 0o600 });

password = '';
console.log('');
console.log('Setup completed successfully.');
console.log('Password self-check: PASSED');
console.log('Next, start the dashboard with scripts\\start-daily.ps1 (or sign in again).');
