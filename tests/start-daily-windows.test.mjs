// Watchdog behaviour with fake roles on random ports: fill what is missing,
// never start duplicates, keep going when the status file cannot be read,
// and stop-daily leaves the Bridge alone. Windows PowerShell 5.1 only.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const startDaily = path.join(repo, 'scripts', 'start-daily.ps1');
const stopDaily = path.join(repo, 'scripts', 'stop-daily.ps1');
const powershell = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const skip = process.platform !== 'win32' ? 'Windows only' : false;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

function httpOk(port, route) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: route, timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitFor(check, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
const pids = (file) => lines(file).map(Number);

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-daily-test-'));
  const marker = (role) => path.join(dir, `${role}.started`);
  // A fake role records its pid when it starts and stays alive.
  const fake = (role, route) => `import fs from 'node:fs'; import http from 'node:http';
fs.appendFileSync(${JSON.stringify(marker(role))}, process.pid + '\\n');
${route ? `http.createServer((q, s) => { s.statusCode = q.url === ${JSON.stringify(route)} ? 200 : 404; s.end('ok'); })
  .listen(Number(process.env.PORT), '127.0.0.1');` : 'setInterval(() => {}, 1 << 30);'}\n`;
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'server.mjs'), fake('dashboard', '/healthz'));
  fs.writeFileSync(path.join(dir, 'scripts', 'run-cru34-live-projection.mjs'), fake('producer'));
  fs.writeFileSync(path.join(dir, 'bridge.mjs'), fake('bridge', '/health'));
  return { dir, marker, statusPath: path.join(dir, 'status.json'), logDir: path.join(dir, 'logs'),
    mutex: `Local\\TwChipStartDailyTest-${crypto.randomUUID()}` };
}

function bridgeStarter(box, port) {
  const file = path.join(box.dir, 'fake-bridge-starter.ps1');
  fs.writeFileSync(file, `$env:PORT='${port}'\r\nStart-Process -FilePath '${process.execPath}' -ArgumentList '"${path.join(box.dir, 'bridge.mjs')}"' -WindowStyle Hidden\r\n`);
  return file;
}

function watchdogArgs(box, ports, extra = []) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', startDaily,
    '-Root', box.dir, '-Node', process.execPath, '-ResearchRoot', box.dir,
    '-BridgeStarter', bridgeStarter(box, ports.bridge), '-BridgePort', String(ports.bridge),
    '-DashboardPort', String(ports.dashboard), '-StatusPath', box.statusPath, '-LogDir', box.logDir,
    '-MutexName', box.mutex, '-IntervalSeconds', '1', ...extra];
}

function runWatchdog(box, ports, ticks) {
  const result = spawnSync(powershell, watchdogArgs(box, ports, ['-Ticks', String(ticks)]), { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function logText(box) {
  if (!fs.existsSync(box.logDir)) return '';
  return fs.readdirSync(box.logDir).filter((f) => f.startsWith('start-daily-'))
    .map((f) => fs.readFileSync(path.join(box.logDir, f), 'utf8')).join('');
}

function cleanup(box) {
  // Kill every fake role still alive, then remove the sandbox.
  spawnSync(powershell, ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${box.dir}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  fs.rmSync(box.dir, { recursive: true, force: true });
}

describe('start-daily watchdog', { skip }, () => {
  let box; let ports; let manualDashboard;
  before(async () => {
    box = makeSandbox();
    ports = { bridge: await freePort(), dashboard: await freePort() };
    // Dashboard already running: the watchdog must leave it alone and fill the other two.
    manualDashboard = spawn(process.execPath, [path.join(box.dir, 'server.mjs')], { env: { ...process.env, PORT: String(ports.dashboard) }, stdio: 'ignore' });
    assert.ok(await waitFor(() => httpOk(ports.dashboard, '/healthz')), 'manual dashboard did not start');
  });
  after(() => { manualDashboard?.kill(); cleanup(box); });

  it('starts only the missing roles', async () => {
    runWatchdog(box, ports, 1);
    assert.ok(await waitFor(() => pids(box.marker('producer')).length === 1), 'producer was not started');
    assert.ok(await waitFor(() => httpOk(ports.bridge, '/health')), 'bridge was not started');
    assert.equal(pids(box.marker('dashboard')).length, 1, 'running dashboard was started again');
    const log = logText(box);
    assert.match(log, /dashboard=UP/);
    assert.match(log, /bridge-started/);
    assert.match(log, /producer-started/);
    assert.doesNotMatch(log, /dashboard-started/);
  });

  it('does not start duplicates on later ticks', async () => {
    runWatchdog(box, ports, 3);
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(pids(box.marker('producer')).length, 1);
    assert.equal(pids(box.marker('bridge')).length, 1);
    assert.equal(pids(box.marker('dashboard')).length, 1);
    assert.match(logText(box), /bridge=UP producer=RUNNING\(pid \d+\) \S+ dashboard=UP\r?\n$/);
  });

  it('allows only one watchdog at a time', async () => {
    const starts = () => (logText(box).match(/WATCHDOG_START/g) || []).length;
    const before = starts();
    const first = spawn(powershell, watchdogArgs(box, ports, ['-Ticks', '4']), { stdio: 'ignore' });
    try {
      assert.ok(await waitFor(() => starts() > before), 'first watchdog did not start');
      const second = spawnSync(powershell, watchdogArgs(box, ports, ['-Ticks', '1']), { encoding: 'utf8', timeout: 60000 });
      assert.equal(second.status, 0);
      assert.match(second.stdout, /ALREADY_RUNNING/);
    } finally {
      await new Promise((r) => (first.exitCode !== null ? r() : first.once('exit', r)));
    }
  });
});

describe('start-daily from nothing, unreadable status, stop-daily', { skip }, () => {
  let box; let ports;
  before(async () => {
    box = makeSandbox();
    ports = { bridge: await freePort(), dashboard: await freePort() };
    fs.writeFileSync(box.statusPath, '{"half-written');
  });
  after(() => cleanup(box));

  it('keeps going when the status file cannot be read, and starts all three', async () => {
    runWatchdog(box, ports, 2);
    const log = logText(box);
    assert.equal((log.match(/status-unreadable/g) || []).length, 2, log);
    assert.ok(await waitFor(() => httpOk(ports.dashboard, '/healthz')), 'dashboard was not started');
    assert.ok(await waitFor(() => httpOk(ports.bridge, '/health')), 'bridge was not started');
    assert.equal(pids(box.marker('producer')).length, 1);
    assert.equal(pids(box.marker('dashboard')).length, 1, 'dashboard started twice inside the grace period');
  });

  it('stop-daily stops dashboard and producer but not the bridge', async () => {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', stopDaily, '-Root', box.dir],
      { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(await waitFor(async () => !(await httpOk(ports.dashboard, '/healthz'))), 'dashboard still answers');
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.ok(await waitFor(() => !alive(pids(box.marker('producer'))[0])), 'producer still alive');
    assert.ok(await httpOk(ports.bridge, '/health'), 'bridge was stopped');
  });
});
