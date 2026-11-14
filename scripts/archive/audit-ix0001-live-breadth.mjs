import fs from 'node:fs';
import readline from 'node:readline';
import { auditIx0001Breadth } from '../src/ix0001-live-breadth.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((arg, index, all) => {
  if (!arg.startsWith('--')) return [arg, true];
  const [key, inline] = arg.slice(2).split('=', 2);
  return [key, inline ?? (all[index + 1]?.startsWith('--') ? true : all[index + 1])];
}));
if (!args.file || !args['trade-date'] || !args['as-of']) {
  throw new Error('Usage: node scripts/audit-ix0001-live-breadth.mjs --file <ledger> --trade-date YYYY-MM-DD --as-of <ISO>');
}

const records = [];
let invalidLines = 0;
const stream = fs.createReadStream(String(args.file), { encoding: 'utf8' });
const input = readline.createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.includes('"IX0001"') || !line.includes('"index_quote"')) continue;
  try {
    const record = JSON.parse(line);
    if (record.kind === 'index_quote' && record.code === 'IX0001') records.push(record);
  } catch {
    invalidLines += 1;
  }
}
const result = auditIx0001Breadth(records, { tradeDate: args['trade-date'], asOf: args['as-of'] });
process.stdout.write(`${JSON.stringify({ ...result, invalidCandidateLines: invalidLines }, null, 2)}\n`);
