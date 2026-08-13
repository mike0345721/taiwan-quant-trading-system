import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectProjectStatus,
  inspectDashboard,
  inspectGit,
  inspectShioaji,
  readBoundedTxTail,
} from '../scripts/project-status.mjs';

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-status-'));
  fs.mkdirSync(path.join(root, 'data', 'live-events'), { recursive: true });
  return root;
}

function hash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('missing services fail closed without leaking response-only secret fields', async () => {
  const unavailable = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal((await inspectDashboard(unavailable)).availability, 'UNAVAILABLE');
  assert.equal((await inspectShioaji(unavailable)).availability, 'UNAVAILABLE');

  const safeHealth = async () => ({ statusCode: 200, payload: {
    ok: true,
    provider: 'shioaji',
    mode: 'market_data_only',
    executionAuthorized: false,
    orderRoutesEnabled: false,
    writerErrors: 3,
    untrustedExtra: 'must-never-be-copied',
    nestedPrivateValue: { value: 'also-must-not-be-copied' },
  } });
  const result = await inspectShioaji(safeHealth);
  const rendered = JSON.stringify(result);
  assert.equal(result.availability, 'AVAILABLE');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.orderRoutesEnabled, false);
  assert.doesNotMatch(rendered, /must-never|nestedPrivateValue|untrustedExtra/);
});

test('git status preserves the complete protected dirty path', () => {
  const responses = new Map([
    ['branch --show-current', 'main'],
    ['rev-parse HEAD', 'a'.repeat(40)],
    ['rev-parse origin/main', 'b'.repeat(40)],
    ['rev-list --left-right --count HEAD...origin/main', '0\t1'],
    ['status --porcelain=v1 --untracked-files=all', ' M v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md'],
  ]);
  const result = inspectGit('C:/fixture', (_root, args) => responses.get(args.join(' ')) ?? '');
  assert.deepEqual(result.dirtyPaths, ['v2/reports/V3_3_OI_NORMALIZATION_AUDIT.md']);
});

test('bounded tail never scans the full large ledger and does not invent a missing TX tick', () => {
  const root = temporaryRoot();
  const ledger = path.join(root, 'data', 'live-events', '2026-08-13.ndjson');
  const early = JSON.stringify({
    kind: 'futures_tick', product: 'TXFH6', receivedAt: '2026-08-13T08:45:00+08:00', exchangeTimestamp: '2026-08-13T08:45:00+08:00',
    duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { _product_family: 'TX', _target_code: 'TXFH6', close: 20000, datetime: '2026-08-13T08:45:00+08:00' },
  });
  fs.writeFileSync(ledger, `${early}\n${'x'.repeat(256 * 1024)}\n`, 'utf8');
  const result = readBoundedTxTail(ledger, 32 * 1024);
  assert.equal(result.availability, 'UNAVAILABLE');
  assert.equal(result.reason, 'TX_TICK_NOT_FOUND_IN_BOUNDED_TAIL');
  assert.ok(result.bytesScanned <= 32 * 1024);
  assert.equal(result.boundedTail, true);
});

test('bounded tail reports actual TX contract and timestamp lineage without mutating ledger', () => {
  const root = temporaryRoot();
  const ledger = path.join(root, 'data', 'live-events', '2026-08-13.ndjson');
  const rows = [
    { kind: 'futures_bidask', product: 'TXFH6', executionAuthorized: false, orderRoutesEnabled: false, payload: { _product_family: 'TX' } },
    {
      kind: 'futures_tick', product: 'TXFH6', receivedAt: '2026-08-13T08:45:00.100+08:00', exchangeTimestamp: '2026-08-13T08:45:00.200+08:00',
      duplicate: false, sequence: null, executionAuthorized: false, orderRoutesEnabled: false,
      payload: { _product_family: 'TX', _target_code: 'TXFH6', close: 20000, datetime: '2026-08-13T08:45:00.200+08:00' },
    },
  ];
  fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`, 'utf8');
  const before = hash(ledger);
  const result = readBoundedTxTail(ledger, 64 * 1024);
  assert.equal(result.availability, 'AVAILABLE');
  assert.equal(result.latestActualContract, 'TXFH6');
  assert.equal(result.nativeSequenceAvailability, 'UNAVAILABLE');
  assert.equal(result.timestampLineageViolationCountInTail, 1);
  assert.equal(hash(ledger), before);
});

test('project status is read only, preserves protected dirty file, and fixes execution boundaries false', async () => {
  const root = temporaryRoot();
  const protectedReport = path.join(root, 'v2', 'reports', 'V3_3_OI_NORMALIZATION_AUDIT.md');
  fs.mkdirSync(path.dirname(protectedReport), { recursive: true });
  fs.writeFileSync(protectedReport, 'owner work in progress\n', 'utf8');
  const before = hash(protectedReport);
  const request = async (url) => {
    if (url.endsWith('/healthz')) return { statusCode: 200, payload: { ok: true, service: 'tw-chip-dashboard-v1', cookie: 'not-copied' } };
    throw new Error('bridge unavailable');
  };
  const report = await collectProjectStatus({
    root,
    request,
    maxTailBytes: 1_024,
    gitProbe: () => ({ availability: 'UNAVAILABLE', reason: 'TEST_FIXTURE' }),
    now: new Date('2026-08-13T00:00:00Z'),
  });
  assert.equal(report.dashboard.availability, 'AVAILABLE');
  assert.equal(report.localMarketData.availability, 'UNAVAILABLE');
  assert.equal(report.database.availability, 'UNAVAILABLE');
  assert.equal(report.forwardShadow.availability, 'UNAVAILABLE');
  assert.deepEqual(report.safety, { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false });
  assert.equal(hash(protectedReport), before);
  const output = JSON.stringify(report);
  assert.doesNotMatch(output, /cookie|password|token|apiKey|place_order|cancel_order/);
});
