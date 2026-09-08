import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const auditScript = fileURLToPath(new URL('../scripts/audit-tx-rvol-baseline-readiness.mjs', import.meta.url));
const source = fs.readFileSync(auditScript, 'utf8');

test('CRU-45 RVOL readiness audit reports missing, rollover and session identity without promotion', () => {
  for (const field of ['missingDays', 'ineligibleCatalogDays', 'rolloverBehavior', 'contractTransitions', 'sessionBehavior']) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /Asia\/Taipei or session-relative bucket identity/);
  assert.match(source, /promotionState: 'RESEARCH_PENDING'/);
  assert.match(source, /does not define a minimum sample threshold/);
  assert.doesNotMatch(source, /爆量[^/]*['"]\s*:/u);
});

test('CRU-45 RVOL audit executes fail-closed for missing contract and does not claim calendar completeness', (context) => {
  const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cru45-rvol-audit-'));
  context.after(() => fs.rmSync(archiveDir, { recursive: true, force: true }));
  const bars = Array.from({ length: 60 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 8, 1, 0, 45 + index * 5)).toISOString(),
    volume: index + 1,
  }));
  const writeDay = (date, contract, dayBars = bars) => {
    fs.writeFileSync(path.join(archiveDir, `${date}-day.json`), JSON.stringify({ contract, bars: dayBars }));
    fs.writeFileSync(path.join(archiveDir, `${date}-audit.json`), JSON.stringify({ state: 'passed' }));
  };
  writeDay('2026-09-01', '202609');
  writeDay('2026-09-02', null);
  writeDay('2026-09-04', '202609', bars.slice(0, 59));

  const run = spawnSync(process.execPath, [auditScript], {
    encoding: 'utf8',
    env: { ...process.env, TX_RVOL_ARCHIVE_DIR: archiveDir },
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.catalogDayFiles, 3);
  assert.equal(report.governedCandidateDays, 1);
  assert.equal(report.missingDays.state, 'UNASSESSED');
  assert.equal(report.missingDays.reason, 'GOVERNED_TRADING_CALENDAR_NOT_CONFIGURED');
  assert.deepEqual(report.ineligibleCatalogDays.map((row) => row.tradeDate), ['2026-09-02', '2026-09-04']);
  assert.match(report.ineligibleCatalogDays[0].reasons.join(','), /CONTRACT_IDENTITY_INCOMPLETE/);
});
