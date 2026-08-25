import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function inlineScript(source) {
  return `<script>${source.replaceAll('</script', '<\\/script')}</script>`;
}

function productionDocument({ omitChangeMetric = false } = {}) {
  let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  if (omitChangeMetric) {
    html = html.replace(/\s*<article><span>[^<]*<\/span><strong id="dw-pulse-change">[\s\S]*?<\/article>/, '');
  }
  html = html
    .replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/g, '')
    .replace(/\s*<script[^>]+src="[^"]+"[^>]*><\/script>/g, '');
  const scripts = [
    'window.LightweightCharts = Object.freeze({});',
    fs.readFileSync(path.join(root, 'public', 'trader-terminal-shell.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8'),
  ].map(inlineScript).join('\n');
  return html.replace('</body>', `${scripts}\n</body>`);
}

function connectPipeCdp(child) {
  const input = child.stdio[3];
  const output = child.stdio[4];
  assert.ok(input && output, 'Chrome DevTools pipe was not created');
  let sequence = 0;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const listeners = new Map();
  const listenerKey = (sessionId, method) => `${sessionId || ''}:${method}`;

  output.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let boundary = buffer.indexOf(0);
    while (boundary >= 0) {
      const packet = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      boundary = buffer.indexOf(0);
      if (!packet) continue;
      const message = JSON.parse(packet);
      if (message.id != null) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) handler?.reject(new Error(message.error.message));
        else handler?.resolve(message.result);
        continue;
      }
      for (const listener of listeners.get(listenerKey(message.sessionId, message.method)) || []) {
        listener(message.params);
      }
    }
  });
  child.once('exit', (code) => {
    for (const handler of pending.values()) handler.reject(new Error(`BROWSER_PIPE_CLOSED:${code}`));
    pending.clear();
  });

  return {
    command(method, params = {}, sessionId = null) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    on(method, listener, sessionId = null) {
      const key = listenerKey(sessionId, method);
      const current = listeners.get(key) || [];
      current.push(listener);
      listeners.set(key, current);
    },
    close() { input.end(); },
  };
}

function sessionClient(pipe, sessionId) {
  return {
    command(method, params = {}) { return pipe.command(method, params, sessionId); },
    on(method, listener) { pipe.on(method, listener, sessionId); },
  };
}

async function waitForPageState(cdp, expression) {
  const deadline = Date.now() + 10_000;
  let lastState = null;
  while (Date.now() < deadline) {
    const result = await cdp.command('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`PAGE_STATE_EVALUATION_FAILED:${JSON.stringify(result.exceptionDetails)}`);
    lastState = result.result.value;
    if (lastState?.rootPresent && lastState.readyState !== 'loading'
      && ((lastState.sessionRequests > 0 && lastState.loginVisible) || lastState.runtimeErrors.length > 0)) return lastState;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`BROWSER_PAGE_TIMEOUT:${JSON.stringify(lastState)}`);
}

async function runProductionDom(options = {}) {
  const binary = browserBinary();
  assert.ok(binary, 'Chrome or Edge is required for the production DOM integration test');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui1-production-dom-'));
  const browser = spawn(binary, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
  const pipe = connectPipeCdp(browser);
  try {
    const { targetId } = await pipe.command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await pipe.command('Target.attachToTarget', { targetId, flatten: true });
    const cdp = sessionClient(pipe, sessionId);
    const exceptions = [];
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails));
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    await cdp.command('Runtime.evaluate', {
      expression: `window.__ui1SessionRequests = 0;
        window.__ui1RuntimeErrors = [];
        window.addEventListener('error', (event) => {
          window.__ui1RuntimeErrors.push({ message: event.message, stack: event.error?.stack || '' });
        });
        window.fetch = async (input) => {
          if (String(input) !== '/api/session') throw new Error('UNEXPECTED_FETCH:' + input);
          window.__ui1SessionRequests += 1;
          return new Response(JSON.stringify({ authenticated: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };`,
    });
    const frameTree = await cdp.command('Page.getFrameTree');
    await cdp.command('Page.setDocumentContent', {
      frameId: frameTree.frameTree.frame.id,
      html: productionDocument(options),
    });
    const pageStateExpression = `(() => {
      const root = document.getElementById('decision-workspace');
      const pulse = document.querySelector('.dw-market-pulse');
      const trend = pulse?.querySelector('.tt-pulse-trend');
      const change = document.getElementById('dw-pulse-change');
      const changeMetric = change?.closest('article') ?? change;
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      return {
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
        sessionRequests: window.__ui1SessionRequests || 0,
        runtimeErrors: window.__ui1RuntimeErrors || [],
      };
    })()`;
    const pageState = await waitForPageState(cdp, pageStateExpression);
    return { pageState, exceptions: [...exceptions, ...pageState.runtimeErrors] };
  } finally {
    pipe.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([
        once(browser, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('production DOM mounts Trader Terminal and reaches session initialization without blocking exceptions', async () => {
  const result = await runProductionDom();
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.pageState.sessionRequests, 1, JSON.stringify(result));
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
  assert.equal(result.pageState.sessionRequests, 1, JSON.stringify(result));
  assert.equal(result.pageState.mounted, true);
  assert.equal(result.pageState.trendCount, 0);
  assert.equal(result.pageState.changeCount, 0);
  assert.deepEqual(result.pageState.duplicateIds, []);
  assert.equal(result.pageState.loginPresent, true);
  assert.equal(result.pageState.loginVisible, true);
});
