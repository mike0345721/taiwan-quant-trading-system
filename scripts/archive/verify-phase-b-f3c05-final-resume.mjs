import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'data', 'research', 'phase-b-f3c05', 'final-incremental-uniqueness-v2');
const excluded = new Set(['RESUME_IDEMPOTENCY.json', 'FULL_PROJECT_REGRESSION.json', 'FINAL_CLOSEOUT_MANIFEST.json', 'CLOSEOUT_SUMMARY.md']);
const hash = (file) => sha256Hex(fs.readFileSync(file));
const snapshot = () => Object.fromEntries(fs.readdirSync(runDir).filter((name) => !excluded.has(name)).sort().map((name) => [name, hash(path.join(runDir, name))]));
const before = snapshot(); const started = Date.now();
const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-phase-b-f3c05-final-uniqueness.mjs'), '--resume'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) throw new Error(`RESUME_COMMAND_FAILED:${result.stderr}`);
const after = snapshot(); if (jcsNfc(before) !== jcsNfc(after)) throw new Error('RESUME_OUTPUT_HASH_CHANGED');
const payload = { status: 'PASS', command: 'node scripts/run-phase-b-f3c05-final-uniqueness.mjs --resume', durationMs: Date.now() - started, before, after, zeroOutputHashChanges: true, zeroCompletedOutputOverwrites: true };
const file = path.join(runDir, 'RESUME_IDEMPOTENCY.json'); const bytes = Buffer.from(jcsNfc(payload));
if (fs.existsSync(file) && hash(file) !== sha256Hex(bytes)) throw new Error('RESUME_EVIDENCE_MISMATCH');
if (!fs.existsSync(file)) { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); }
process.stdout.write(`${JSON.stringify({ status: 'PASS', durationMs: payload.durationMs }, null, 2)}\n`);
