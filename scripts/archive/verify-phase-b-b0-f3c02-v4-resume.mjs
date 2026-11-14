import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/phase-b-b0-v4-core.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v4');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'OUTPUT_MANIFEST.json'), 'utf8')); const mismatches = manifest.files.filter((r) => !fs.existsSync(path.join(dir, r.name)) || sha256Hex(fs.readFileSync(path.join(dir, r.name))) !== r.sha256);
const result = { status: mismatches.length ? 'HARD_FAIL' : 'COMPLETED_ALREADY_ZERO_WRITES', checkedFiles: manifest.files.length, mismatchCount: mismatches.length, recomputedJobs: 0, formalWeight: 0, researchOnly: true, executionAuthorized: false };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (mismatches.length) process.exitCode = 2;

