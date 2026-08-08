import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { appendPaperEvent, loadOfficialReplayEvidence } from '../src/paper-event-ledger.mjs';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archiveDir = path.join(appRoot, 'data', 'intraday', 'archive');
const ledgerPath = path.join(appRoot, 'data', 'forward', 'v3.8-paper-events.jsonl');
const inputIndex = process.argv.indexOf('--input');
if (inputIndex < 0 || !process.argv[inputIndex + 1]) {
  console.error('Usage: node scripts/append-paper-event.mjs --input <event.json>');
  process.exit(2);
}
const inputPath = path.resolve(process.cwd(), process.argv[inputIndex + 1]);
if (!fs.existsSync(inputPath)) throw new Error('PAPER_EVENT_INPUT_NOT_FOUND');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const evidence = loadOfficialReplayEvidence(archiveDir, input);
const result = appendPaperEvent(ledgerPath, input, evidence);
console.log(JSON.stringify({
  ledgerPath,
  appended: result.appended,
  total: result.total,
  eventId: result.record.eventId,
  eventType: result.record.eventType,
  recordHash: result.record.recordHash,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));

