import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { importFiveMinuteBars } from '../src/intraday-import.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const input = argument('--input');
const mode = argument('--mode') || 'live';
if (!input || !['live', 'replay'].includes(mode)) {
  console.error('Usage: node scripts/import-intraday-bars.mjs --input <file.json> [--mode live|replay]');
  process.exit(2);
}

const inputPath = path.resolve(input);
const outputPath = path.resolve('data', 'intraday', mode === 'replay' ? 'replay-bars.json' : 'latest-bars.json');
try {
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = importFiveMinuteBars(payload, outputPath, { allowHistorical: mode === 'replay' });
  if (!result.ok) {
    console.error(`Import rejected: ${result.errors.join(', ')}`);
    process.exit(1);
  }
  console.log(`Imported ${result.payload.barCount} bars to ${result.outputPath}`);
} catch (error) {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
}
