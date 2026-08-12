import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('daily-use launcher keeps normal startup on the formal local dashboard only', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.match(source, /http:\/\/127\.0\.0\.1:8787/);
  assert.match(source, /launcher\.mjs/);
  assert.match(source, /start-shioaji-readonly-hidden\.ps1/);
  assert.doesNotMatch(source, /8797|8798|cloudflared|trycloudflare/i);
  assert.doesNotMatch(source, /run-daily-update|run-startup-recovery|run-v3-daily-update/i);
});

test('daily-use launcher remains Git read-only and does not enable execution', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.doesNotMatch(source, /git\s+(pull|fetch|reset|checkout|rebase|stash|clean|merge)/i);
  assert.match(source, /executionAuthorized=false/);
  assert.match(source, /orderRoutesEnabled=false/);
  assert.match(source, /market_data_only/);
});

test('daily-use launcher guards unknown occupied ports and repeated clicks', () => {
  const source = read('scripts/start-daily-use.ps1');
  assert.match(source, /daily-use-bootstrap\.lock/);
  assert.match(source, /A normal startup is already running/);
  assert.match(source, /Port 8787 is occupied by a service that does not pass its health check/);
  assert.doesNotMatch(source, /taskkill|Stop-Process|kill all/i);
});

test('desktop shortcut installer uses the Desktop known folder and a small local wrapper', () => {
  const source = read('scripts/install-daily-use-shortcut.ps1');
  assert.match(source, /Namespace\(0x10\)/);
  assert.match(source, /台股量化籌碼神器－正常使用\.lnk/);
  assert.match(source, /data\\launchers/);
  assert.match(source, /START_DAILY_USE\.bat/);
  assert.match(source, /DAILY_USE_BOOTSTRAP_V1/);
  assert.doesNotMatch(source, /C:\\Users\\|OneDrive\\Desktop|Remove-Item/i);
});
