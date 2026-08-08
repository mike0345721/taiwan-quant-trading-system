import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditPaidTaifexReplay,
  promotePaidCandidateArchives,
} from '../src/paid-taifex-import.mjs';

function bars(count, start, price = 100) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(Date.parse(start) + index * 300_000).toISOString(),
    open: price,
    high: price + 2,
    low: price - 2,
    close: price + 1,
    volume: 10,
    complete: true,
  }));
}

test('paid replay audit requires complete sessions and exact official OHLC', () => {
  const day = bars(60, '2026-01-02T00:45:00.000Z');
  const night = bars(168, '2025-12-31T07:00:00.000Z');
  const result = {
    acceptedTicks: 1000,
    malformedTicks: 0,
    selectedContract: '202601',
    sessions: {
      day: { contract: '202601', bars: day },
      night: { contract: '202601', bars: night },
    },
  };
  const report = auditPaidTaifexReplay({
    tradeDate: '2026-01-02',
    result,
    officialRows: [{
      contract: '202601',
      is_active: 1,
      open: 100,
      high: 102,
      low: 98,
      close: 101,
      volume: 1000,
    }],
  });
  assert.equal(report.pass, true);
  assert.equal(report.contract, '202601');
  assert.equal(report.checks.daySessionCoverage.pass, true);
  assert.equal(report.checks.nightSessionCoverage.pass, true);
});

test('promotion refuses to overwrite a conflicting formal archive', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-paid-promote-'));
  const candidate = path.join(folder, 'candidate');
  const archive = path.join(folder, 'archive');
  fs.mkdirSync(candidate);
  fs.mkdirSync(archive);
  try {
    for (const session of ['day', 'night']) {
      fs.writeFileSync(path.join(candidate, `2026-01-02-${session}.json`), JSON.stringify({
        contract: '202601', session, bars: [{ close: 100 }],
      }));
      fs.writeFileSync(path.join(archive, `2026-01-02-${session}.json`), JSON.stringify({
        contract: '202601', session, bars: [{ close: 101 }],
      }));
    }
    assert.throws(
      () => promotePaidCandidateArchives(candidate, archive, ['2026-01-02']),
      /PAID_CANDIDATE_CONFLICT/,
    );
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
