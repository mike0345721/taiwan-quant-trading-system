// stdin-only interactive launch protocol; no command-line password, env hash or receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertOwnerConsent, admitOwner, stopOwner, ownerStopping } from '../src/owner-local-acceptance.mjs';
import { assertPlainLocalPath, verifyInteractiveOwnerParent, verifyOwnerBinding, prepareOwnerRoots, ownerEnvironment } from '../src/owner-local-startup.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let received = false, pending = '', starting = false;
const fail = error => {
  const code = /^(?:OWNER|MARKET_CANDIDATE)_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'OWNER_ENTRY_REJECTED_OR_UNAVAILABLE';
  console.error(code); process.exit(1);
};
if (process.argv.length !== 2 || process.stdin.isTTY || process.platform !== 'win32'
    || Object.entries(process.env).some(([key, value]) => value && /^(NODE_OPTIONS|NODE_PATH|GIT_.*)$/i.test(key))) fail();

async function start(line) {
  let input;
  try {
    input = JSON.parse(line);
    assertOwnerConsent(input); // Must precede binding, source, private or auth I/O.
    if (ownerStopping()) throw Error('OWNER_CANCELLED');
    verifyInteractiveOwnerParent(path.join(appRoot, 'scripts/start-owner-local-acceptance.ps1'), input.bindingPath);
    assertPlainLocalPath(input.bindingPath, false);
    const stat = fs.statSync(input.bindingPath);
    if (stat.size > 16384) throw Error('OWNER_BINDING_OVERSIZE');
    const binding = JSON.parse(fs.readFileSync(input.bindingPath, 'utf8').replace(/^\uFEFF/, ''));
    verifyOwnerBinding(binding, appRoot);
    const runId = crypto.randomUUID();
    // Validate split roots before any private directory creation.
    const roots = prepareOwnerRoots(binding, runId);
    admitOwner(input, binding, runId);
    const env = ownerEnvironment(binding, roots);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    if (ownerStopping()) throw Error('OWNER_CANCELLED');
    await import('../server.mjs');
    starting = false;
  } catch (error) { if (input) input.password = ''; fail(error); }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  pending += chunk;
  if (Buffer.byteLength(pending) > 16384) return fail();
  let index;
  while ((index = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, index).replace(/\r$/, ''); pending = pending.slice(index + 1);
    if (!received) { received = true; starting = true; void start(line); }
    else if (line === 'STOP') { stopOwner(); if (starting) fail(); }
    else fail();
  }
});
process.stdin.on('end', () => { stopOwner(); if (!received || starting) process.exit(1); });
process.stdin.on('error', fail);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
