import path from 'node:path';
import process from 'node:process';

import { materializeCru34HistoricalLedger } from '../src/cru34-historical-materializer.mjs';

function values(name) {
  const result = [];
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === exact) {
      result.push(process.argv[index + 1]);
      index += 1;
    } else if (argument.startsWith(prefix)) {
      result.push(argument.slice(prefix.length));
    }
  }
  return result.filter((value) => value != null && value !== '');
}

function required(name) {
  const value = values(name).at(-1);
  if (!value) throw new Error(`CRU36_CLI_${name.toUpperCase().replaceAll('-', '_')}_REQUIRED`);
  return value;
}

function cutoffs() {
  return values('cutoff').flatMap((value) => value.split(',')).map((value) => Number(value.trim()));
}

async function main() {
  const result = await materializeCru34HistoricalLedger({
    ledgerPath: path.resolve(required('ledger')),
    artifactRoot: path.resolve(required('artifact-root')),
    cutoffLedgerOrdinals: cutoffs(),
    expectedSourceSha256: required('expected-source-sha256'),
    expectedIdentity: {
      actualContract: required('actual-contract'),
      tradeDate: required('trade-date'),
      session: required('session'),
      continuityEpoch: required('continuity-epoch'),
    },
    instrumentProfile: {
      instrument: 'TX',
      product: 'TX',
      market: 'TAIFEX',
      tickSize: Number(required('tick-size')),
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', error: String(error?.message || error) }, null, 2)}\n`);
  process.exitCode = 1;
});
