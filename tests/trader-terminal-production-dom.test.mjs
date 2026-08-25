import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function browserBinary() {
  const candidates = [
    process.env.BROWSER_BINARY,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function startProductionServer({ omitChangeMetric = false } = {}) {
  let sessionRequests = 0;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/session') {
      sessionRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ authenticated: false }));
      return;
    }
    if (pathname === '/vendor/lightweight-charts.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('window.LightweightCharts = Object.freeze({});');
      return;
    }
    const files = new Map([
      ['/', ['public/index.html', 'text/html; charset=utf-8']],
      ['/index.html', ['public/index.html', 'text/html; charset=utf-8']],
      ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
      ['/trader-terminal-shell.css', ['public/trader-terminal-shell.css', 'text/css; charset=utf-8']],
      ['/trader-terminal-shell.js', ['public/trader-terminal-shell.js', 'text/javascript; charset=utf-8']],
      ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
    ]);
    const entry = files.get(pathname);
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    let body = fs.readFileSync(path.join(root, entry[0]), 'utf8');
    if (omitChangeMetric && pathname === '/') {
      body = body.replace(/\s*<article><span>[^<]*<\/span><strong id="dw-pulse-change">[\s\S]*?<\/article>/, '');
    }
    response.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' });
    response.end(body);
  });
  return { server, sessionRequestCount: () => sessionRequests };
}

async function devtoolsEndpoint(child) {
  child.stderr.setEncoding('utf8');
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('BROWSER_DEVTOOLS_TIMEOUT')), 10_000);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`BROWSER_EXITED_BEFORE_DEVTOOLS:${code}:${stderr}`));
    });
  });
}

async function pageWebSocket(browserEndpoint) {
  const endpoint = new URL(browserEndpoint);
  const response = await fetch(`http://${endpoint.host}/json/list`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('BROWSER_PAGE_TARGET_MISSING');
  return page.webSocketDebuggerUrl;
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler?.reject(new Error(message.error.message));
      else handler?.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params);
  });
  return {
    command(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const current = listeners.get(method) || [];
      current.push(listener);
      listeners.set(method, current);
    },
    close() { socket.close(); },
  };
}

async function waitForPageState(cdp, expression, sessionRequestCount) {
  const deadline = Date.now() + 10_000;
  let lastState = null;
  while (Date.now() < deadline) {
    const result = await cdp.command('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`PAGE_STATE_EVALUATION_FAILED:${JSON.stringify(result.exceptionDetails)}`);
    lastState = result.result.value;
    if (lastState?.rootPresent && lastState.readyState !== 'loading'
      && ((sessionRequestCount() > 0 && lastState.loginVisible) || lastState.runtimeErrors.length > 0)) return lastState;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`BROWSER_PAGE_TIMEOUT:${JSON.stringify(lastState)}`);
}

async function runProductionDom(options = {}) {
  const binary = browserBinary();
  assert.ok(binary, 'Chrome or Edge is required for the production DOM integration test');
  const { server, sessionRequestCount } = startProductionServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui1-production-dom-'));
  const browser = spawn(binary, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let cdp;
  try {
    const endpoint = await devtoolsEndpoint(browser);
    cdp = await connectCdp(await pageWebSocket(endpoint));
    const exceptions = [];
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails));
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__ui1RuntimeErrors = [];
        window.addEventListener('error', (event) => {
          window.__ui1RuntimeErrors.push({ message: event.message, stack: event.error?.stack || '' });
        });`,
    });
    const navigation = await cdp.command('Page.navigate', { url: origin });
    if (navigation.errorText) throw new Error(`PAGE_NAVIGATION_FAILED:${JSON.stringify(navigation)}`);
    const pageStateExpression = `(() => {
      const root = document.getElementById('decision-workspace');
      const pulse = document.querySelector('.dw-market-pulse');
      const trend = pulse?.querySelector('.tt-pulse-trend');
      const change = document.getElementById('dw-pulse-change');
      const changeMetric = change?.closest('article') ?? change;
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      return {
        url: location.href,
        readyState: document.readyState,
        rootPresent: Boolean(root),
        mounted: root?.dataset.terminalMounted === 'true',
        trendCount: pulse?.querySelectorAll('.tt-pulse-trend').length ?? 0,
        changeCount: document.querySelectorAll('#dw-pulse-change').length,
        changeInsideGrid: Boolean(document.querySelector('.dw-pulse-grid')?.contains(change)),
        trendSharesChangeParent: Boolean(trend && trend.parentElement === changeMetric?.parentElement),
        trendImmediatelyBeforeChange: Boolean(trend && changeMetric?.previousElementSibling === trend),
        duplicateIds: [...new Set(duplicates)],
        loginPresent: Boolean(document.getElementById('login-view')),
        loginVisible: !document.getElementById('login-view')?.classList.contains('hidden'),
        runtimeErrors: window.__ui1RuntimeErrors || [],
      };
    })()`;
    const pageState = await waitForPageState(cdp, pageStateExpression, sessionRequestCount);
    return { pageState, exceptions: [...exceptions, ...pageState.runtimeErrors], sessionRequests: sessionRequestCount() };
  } finally {
    cdp?.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([
        once(browser, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('production DOM mounts Trader Terminal and reaches session initialization without blocking exceptions', async () => {
  const result = await runProductionDom();
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.sessionRequests, 1, JSON.stringify(result));
  assert.equal(result.pageState.mounted, true);
  assert.equal(result.pageState.trendCount, 1);
  assert.equal(result.pageState.changeCount, 1);
  assert.equal(result.pageState.changeInsideGrid, true);
  assert.equal(result.pageState.trendSharesChangeParent, true);
  assert.equal(result.pageState.trendImmediatelyBeforeChange, true);
  assert.deepEqual(result.pageState.duplicateIds, []);
  assert.equal(result.pageState.loginPresent, true);
  assert.equal(result.pageState.loginVisible, true);
});

test('missing optional pulse change metric fails soft and still reaches session initialization', async () => {
  const result = await runProductionDom({ omitChangeMetric: true });
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.sessionRequests, 1, JSON.stringify(result));
  assert.equal(result.pageState.mounted, true);
  assert.equal(result.pageState.trendCount, 0);
  assert.equal(result.pageState.changeCount, 0);
  assert.deepEqual(result.pageState.duplicateIds, []);
  assert.equal(result.pageState.loginPresent, true);
  assert.equal(result.pageState.loginVisible, true);
});
