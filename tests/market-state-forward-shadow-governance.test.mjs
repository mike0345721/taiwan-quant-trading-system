import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadGovernedTradingCalendar, resolveGovernedTradingDay } from '../src/market-state-forward-shadow-calendar.mjs';
import { collectForwardLargeMoveOutcome } from '../src/market-state-forward-shadow-outcome-collector.mjs';
import { replicateOperationalSecondCopy } from '../src/market-state-forward-shadow-backup.mjs';
import { digest } from '../src/market-state-forward-shadow.mjs';

const root = path.resolve('data/market-state/forward-shadow/cru22-governance-fixtures');
const HASH = 'a'.repeat(64);

test('governed trading calendar is deterministic and holiday is not a scheduled trading day', () => {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'calendar.json');
  const body = {
    schemaVersion: 'taifex-governed-trading-calendar-v1',
    sourceType: 'TAIFEX_OFFICIAL_CALENDAR_SNAPSHOT',
    ownerApproved: true,
    sourceHash: HASH,
    tradingDates: ['2026-08-11'],
    nonTradingDates: ['2026-08-10'],
    coverageStart: '2026-08-10',
    coverageEnd: '2026-08-11',
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  fs.writeFileSync(file, JSON.stringify({ ...body, fileHash: digest(body) }));
  const first = loadGovernedTradingCalendar(file);
  const second = loadGovernedTradingCalendar(file);
  assert.equal(first.fileHash, second.fileHash);
  assert.equal(resolveGovernedTradingDay(first, '2026-08-11').officialTradingDay, true);
  assert.equal(resolveGovernedTradingDay(first, '2026-08-10').officialTradingDay, false);
  assert.throws(() => resolveGovernedTradingDay(first, '2026-08-12'), /TRADING_DAY_NOT_COVERED/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('owner-approved TAIFEX 2026 snapshot covers known trading/non-trading dates and fails closed outside coverage', () => {
  const calendar = loadGovernedTradingCalendar(path.resolve('config/taifex-official-calendar-2026.json'));
  assert.equal(calendar.payload.sourceType, 'TAIFEX_OFFICIAL_CALENDAR_SNAPSHOT');
  assert.equal(calendar.payload.sourceHash, '8619b50dd46e4c2b817010cfa0774de3a2301181babf0117b1d28755df09d475');
  assert.equal(resolveGovernedTradingDay(calendar, '2026-08-11').officialTradingDay, true);
  assert.equal(resolveGovernedTradingDay(calendar, '2026-09-25').officialTradingDay, false);
  assert.throws(() => resolveGovernedTradingDay(calendar, '2027-01-04'), /TRADING_DAY_NOT_COVERED/);
});

test('optional official exception evidence overrides a base date without changing the base calendar hash', () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const basePath = path.resolve('config/taifex-official-calendar-2026.json');
  const base = loadGovernedTradingCalendar(basePath);
  const baseHash = base.fileHash;
  const exceptionPath = path.join(root, 'official-exception.json');
  const exceptionBody = {
    schemaVersion: 'taifex-official-calendar-exception-v1',
    sourceType: 'TAIFEX_OFFICIAL_EXCEPTION_EVIDENCE',
    ownerApproved: true,
    sourceHash: HASH,
    exceptions: [{
      tradeDate: '2026-08-11',
      officialTradingDay: false,
      reason: 'OFFICIAL_EMERGENCY_CLOSURE_TEST_FIXTURE',
    }],
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  fs.writeFileSync(exceptionPath, JSON.stringify({ ...exceptionBody, fileHash: digest(exceptionBody) }));
  const governed = loadGovernedTradingCalendar(basePath, exceptionPath);
  const resolved = resolveGovernedTradingDay(governed, '2026-08-11');
  assert.equal(resolved.officialTradingDay, false);
  assert.equal(resolved.state, 'NON_TRADING_DAY_EXCEPTION');
  assert.equal(resolved.exceptionEvidence.evidenceFileHash, digest(exceptionBody));
  assert.equal(governed.fileHash, baseHash);
  assert.equal(loadGovernedTradingCalendar(basePath).fileHash, baseHash);
  fs.rmSync(root, { recursive: true, force: true });
});

test('official exception evidence fails closed on invalid hash or missing Owner approval', () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const basePath = path.resolve('config/taifex-official-calendar-2026.json');
  const exceptionPath = path.join(root, 'official-exception.json');
  const body = {
    schemaVersion: 'taifex-official-calendar-exception-v1',
    sourceType: 'TAIFEX_OFFICIAL_EXCEPTION_EVIDENCE',
    ownerApproved: true,
    sourceHash: HASH,
    exceptions: [{ tradeDate: '2026-08-11', officialTradingDay: false }],
  };
  fs.writeFileSync(exceptionPath, JSON.stringify({ ...body, fileHash: 'b'.repeat(64) }));
  assert.throws(() => loadGovernedTradingCalendar(basePath, exceptionPath), /EXCEPTION_HASH_INVALID/);
  const unapproved = { ...body, ownerApproved: false };
  fs.writeFileSync(exceptionPath, JSON.stringify({ ...unapproved, fileHash: digest(unapproved) }));
  assert.throws(() => loadGovernedTradingCalendar(basePath, exceptionPath), /EXCEPTION_GOVERNANCE_INVALID/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('forward outcome collector reuses frozen LARGE_MOVE sessionReturnBps and actual contract lineage', async () => {
  fs.mkdirSync(root, { recursive: true });
  const ledger = path.join(root, 'live.ndjson');
  const row = (time, close, id) => JSON.stringify({
    kind: 'futures_tick', eventId: id, exchangeTimestamp: time, receivedAt: time,
    payload: { _product_family: 'TX', date: '2026-08-11', _target_code: '202608', simtrade: false, close, volume: 1 },
  });
  fs.writeFileSync(ledger, `${row('2026-08-11T00:45:00.000Z', 20000, 'a')}\n${row('2026-08-11T05:44:59.000Z', 20200, 'b')}\n`);
  const result = await collectForwardLargeMoveOutcome({
    ledgerFile: ledger,
    tradeDate: '2026-08-11',
    actualContract: '202608',
    outcomeContract: { version: 'market-state-outcome-contract-v1', sha256: HASH },
    collectedAt: '2026-08-11T13:50:00+08:00',
  });
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(result.outcome.actualContract, '202608');
  assert.equal(result.outcome.sessionReturnBps, 100);
  assert.equal(result.outcome.outcomeSourceLineage.session, 'DAY');
  assert.equal(result.outcome.outcomeSourceLineage.actualContract, '202608');
  assert.match(result.outcome.outcomeSourceHash, /^[a-f0-9]{64}$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('operational second copy is checksum-identical, idempotent and rejects conflicting evidence', () => {
  const primary = path.join(root, 'primary', 'backup-test');
  const backup = path.join(root, 'backup');
  fs.rmSync(root, { recursive: true, force: true });
  for (const directory of ['official-records', 'checksums', 'daily-status', 'logs']) fs.mkdirSync(path.join(primary, directory), { recursive: true });
  fs.writeFileSync(path.join(primary, 'launch-manifest.json'), '{"launch":"fixture"}\n');
  fs.writeFileSync(path.join(primary, 'official-ledger.ndjson'), '{"record":"fixture"}\n');
  fs.writeFileSync(path.join(primary, 'official-records', '1.json'), '{"official":true}\n');
  fs.writeFileSync(path.join(primary, 'checksums', 'official_forward-1.json'), '{"checksum":"fixture"}\n');
  fs.writeFileSync(path.join(primary, 'daily-status', 'official_forward-2026-08-11-state.json'), '{"status":"complete"}\n');
  const first = replicateOperationalSecondCopy({ primaryRunRoot: primary, backupRoot: backup, runId: 'backup-test' });
  const second = replicateOperationalSecondCopy({ primaryRunRoot: primary, backupRoot: backup, runId: 'backup-test' });
  assert.equal(first.status, 'PASS');
  assert.equal(first.checksumParity, true);
  assert.equal(second.copiedCount, 0);
  assert.equal(second.unchangedCount, first.fileCount);
  fs.writeFileSync(path.join(backup, 'backup-test', 'official-ledger.ndjson'), '{"different":true}\n');
  assert.throws(() => replicateOperationalSecondCopy({ primaryRunRoot: primary, backupRoot: backup, runId: 'backup-test' }), /BACKUP_CONFLICT/);
  fs.rmSync(root, { recursive: true, force: true });
});
