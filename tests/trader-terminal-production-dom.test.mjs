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

function inlineStyle(source) {
  return `<style>${source.replaceAll('</style', '<\\/style')}</style>`;
}

function lightweightChartsBundle() {
  const relative = path.join('node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');
  const candidates = [process.env.LIGHTWEIGHT_CHARTS_BUNDLE].filter(Boolean);
  for (let current = root; ; current = path.dirname(current)) {
    candidates.push(path.join(current, relative));
    if (path.dirname(current) === current) break;
  }
  const bundle = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(bundle, 'The installed lightweight-charts production bundle is required for interactive Production DOM coverage');
  return fs.readFileSync(bundle, 'utf8');
}

function productionDocument({ omitChangeMetric = false, interactive = false } = {}) {
  let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  if (omitChangeMetric) {
    html = html.replace(/\s*<article><span>[^<]*<\/span><strong id="dw-pulse-change">[\s\S]*?<\/article>/, '');
  }
  html = html
    .replace(/\s*<link[^>]+rel="stylesheet"[^>]*>/g, '')
    .replace(/\s*<script[^>]+src="[^"]+"[^>]*><\/script>/g, '');
  const styles = interactive
    ? [
      fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8'),
      fs.readFileSync(path.join(root, 'public', 'trader-terminal-shell.css'), 'utf8'),
    ].map(inlineStyle).join('\n')
    : '';
  const scripts = [
    interactive ? lightweightChartsBundle() : 'window.LightweightCharts = Object.freeze({});',
    fs.readFileSync(path.join(root, 'public', 'trader-terminal-shell.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8'),
  ].map(inlineScript).join('\n');
  return html.replace('</head>', `${styles}\n</head>`).replace('</body>', `${scripts}\n</body>`);
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

async function evaluate(cdp, expression) {
  const result = await cdp.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`PAGE_EVALUATION_FAILED:${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}

async function waitForValue(cdp, expression, predicate, label) {
  const deadline = Date.now() + 10_000;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(cdp, expression);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label}:${JSON.stringify(value)}`);
}

async function waitAnimationFrames(cdp, count = 4) {
  await evaluate(cdp, `new Promise((resolve) => {
    let remaining = ${count};
    const next = () => { remaining -= 1; remaining > 0 ? requestAnimationFrame(next) : resolve(true); };
    requestAnimationFrame(next);
  })`);
}

async function setViewport(cdp, width, height) {
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await waitAnimationFrames(cdp, 6);
}

async function clickSelector(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
    };
  })()`);
  assert.ok(point && point.width > 0 && point.height > 0, `Clickable selector is not visible: ${selector}`);
  await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await waitAnimationFrames(cdp, 4);
}

const interactiveStateExpression = `(() => {
  const root = document.getElementById('decision-workspace');
  const activePages = [...document.querySelectorAll('[data-page].is-active-page')].map((node) => node.dataset.page);
  const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  return {
    mounted: root?.dataset.terminalMounted === 'true',
    dashboardVisible: !document.getElementById('dashboard-view')?.classList.contains('hidden'),
    activePages,
    duplicateIds,
    expandPresent: Boolean(document.getElementById('tt-chart-expand')),
    chartCanvasCount: document.querySelectorAll('.dw-chart-canvas canvas').length,
  };
})()`;

const layoutMeasurementExpression = `(() => {
  const root = document.getElementById('decision-workspace');
  const owner = root?.querySelector('.tt-primary-grid > .dw-price-region');
  const stage = root?.querySelector('.dw-chart-stage');
  const host = root?.querySelector('.dw-chart-canvas');
  const round = (value) => Math.round(value * 100) / 100;
  return {
    expanded: root?.classList.contains('is-chart-expanded') ?? false,
    ownerHeight: round(owner?.getBoundingClientRect().height || 0),
    stageHeight: round(stage?.getBoundingClientRect().height || 0),
    hostHeight: round(host?.getBoundingClientRect().height || 0),
    canvasHeights: [...(host?.querySelectorAll('canvas') || [])].map((canvas) => round(canvas.getBoundingClientRect().height)),
    documentHeight: document.documentElement.scrollHeight,
    viewport: [innerWidth, innerHeight],
  };
})()`;

async function stableLayoutSamples(cdp, count = 5) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    await waitAnimationFrames(cdp, 3);
    samples.push(await evaluate(cdp, layoutMeasurementExpression));
  }
  return samples;
}

function spread(values) {
  return Math.max(...values) - Math.min(...values);
}

function assertExpandedLayoutBounded(sample) {
  assert.equal(sample.expanded, true, JSON.stringify(sample));
  assert.ok(sample.ownerHeight > 0 && sample.ownerHeight <= 961, JSON.stringify(sample));
  assert.ok(sample.stageHeight > 0 && sample.stageHeight <= sample.ownerHeight + 1, JSON.stringify(sample));
  assert.ok(sample.hostHeight > 0 && sample.hostHeight <= sample.stageHeight + 1, JSON.stringify(sample));
  assert.ok(sample.canvasHeights.length > 0, JSON.stringify(sample));
  assert.ok(sample.canvasHeights.every((height) => height > 0 && height <= sample.hostHeight + 1), JSON.stringify(sample));
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

async function runProductionInteractionRegression() {
  const binary = browserBinary();
  assert.ok(binary, 'Chrome or Edge is required for the Production DOM interaction regression');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui1-production-interaction-'));
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
    const blockingConsoleErrors = [];
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (!['error', 'assert'].includes(type)) return;
      blockingConsoleErrors.push(args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
    });
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    await setViewport(cdp, 1536, 864);
    await cdp.command('Runtime.evaluate', {
      expression: `window.__ui1SessionRequests = 0;
        window.__ui1ApiRequests = [];
        window.__ui1RuntimeErrors = [];
        window.addEventListener('error', (event) => {
          window.__ui1RuntimeErrors.push({ message: event.message, stack: event.error?.stack || '' });
        });
        window.fetch = async (input) => {
          const raw = String(input);
          const url = new URL(raw, 'http://ui1.test');
          window.__ui1ApiRequests.push(url.pathname + url.search);
          if (url.pathname !== '/api/session') return new Promise(() => {});
          window.__ui1SessionRequests += 1;
          return new Response(JSON.stringify({ authenticated: true, csrfToken: '' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };`,
    });
    const frameTree = await cdp.command('Page.getFrameTree');
    await cdp.command('Page.setDocumentContent', {
      frameId: frameTree.frameTree.frame.id,
      html: productionDocument({ interactive: true }),
    });

    await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.mounted && value.dashboardVisible && value.activePages.length === 1
        && value.activePages[0] === 'workspace' && value.expandPresent,
      'AUTHENTICATED_PRODUCTION_DOM_TIMEOUT',
    );
    await evaluate(cdp, `(() => {
      const host = document.querySelector('.dw-chart-canvas');
      if (!host || !window.LightweightCharts?.createChart) return false;
      window.__ui1LayoutChart = window.LightweightCharts.createChart(host, {
        autoSize: true,
        layout: { background: { color: '#07131f' }, textColor: '#9fb0c6' },
      });
      return true;
    })()`);
    const initialState = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.mounted && value.dashboardVisible && value.activePages.length === 1
        && value.activePages[0] === 'workspace' && value.expandPresent && value.chartCanvasCount > 0,
      'PRODUCTION_CHART_MOUNT_TIMEOUT',
    );

    const routeStates = [];
    for (const route of ['workspace', 'today', 'market', 'options', 'intraday', 'research', 'quality']) {
      await clickSelector(cdp, `[data-dashboard-page="${route}"]`);
      routeStates.push(await waitForValue(
        cdp,
        interactiveStateExpression,
        (value) => value?.activePages.length === 1 && value.activePages[0] === route,
        `ROUTE_ISOLATION_FAILED:${route}`,
      ));
    }
    await clickSelector(cdp, '[data-dashboard-page="workspace"]');
    await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.activePages.length === 1 && value.activePages[0] === 'workspace',
      'WORKSPACE_RESTORE_FAILED',
    );

    await clickSelector(cdp, '#tt-chart-expand');
    await waitForValue(
      cdp,
      layoutMeasurementExpression,
      (value) => value?.expanded,
      'CHART_EXPAND_FAILED',
    );
    const viewportEvidence = [];
    for (const [width, height] of [[1536, 864], [1920, 1080], [2048, 1018]]) {
      await setViewport(cdp, width, height);
      viewportEvidence.push({ width, height, samples: await stableLayoutSamples(cdp, 6) });
    }
    await setViewport(cdp, 1536, 864);
    await clickSelector(cdp, '#tt-chart-expand');
    await waitForValue(
      cdp,
      layoutMeasurementExpression,
      (value) => value && !value.expanded,
      'CHART_RESTORE_FAILED',
    );

    const cycleEvidence = [];
    for (let cycle = 1; cycle <= 10; cycle += 1) {
      await clickSelector(cdp, '#tt-chart-expand');
      const expanded = (await stableLayoutSamples(cdp, 5)).at(-1);
      await clickSelector(cdp, '#tt-chart-expand');
      const restored = (await stableLayoutSamples(cdp, 5)).at(-1);
      cycleEvidence.push({ cycle, expanded, restored });
    }

    const finalState = await evaluate(cdp, interactiveStateExpression);
    const runtimeErrors = await evaluate(cdp, 'window.__ui1RuntimeErrors || []');
    const apiRequests = await evaluate(cdp, 'window.__ui1ApiRequests || []');
    return {
      initialState,
      routeStates,
      viewportEvidence,
      cycleEvidence,
      finalState,
      apiRequests,
      exceptions: [...exceptions, ...runtimeErrors],
      blockingConsoleErrors,
    };
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

test('authenticated Production DOM navigation and chart layout remain isolated and bounded', { timeout: 120_000 }, async () => {
  const result = await runProductionInteractionRegression();
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.blockingConsoleErrors, []);
  assert.equal(result.initialState.mounted, true);
  assert.equal(result.initialState.dashboardVisible, true);
  assert.deepEqual(result.initialState.activePages, ['workspace']);
  assert.ok(result.initialState.chartCanvasCount > 0);
  assert.deepEqual(result.initialState.duplicateIds, []);

  assert.equal(result.routeStates.length, 7);
  result.routeStates.forEach((state, index) => {
    assert.deepEqual(state.activePages, [['workspace', 'today', 'market', 'options', 'intraday', 'research', 'quality'][index]]);
    assert.deepEqual(state.duplicateIds, []);
  });

  assert.deepEqual(result.viewportEvidence.map(({ width, height }) => [width, height]), [
    [1536, 864], [1920, 1080], [2048, 1018],
  ]);
  for (const evidence of result.viewportEvidence) {
    evidence.samples.forEach(assertExpandedLayoutBounded);
    assert.ok(spread(evidence.samples.map((sample) => sample.ownerHeight)) <= 2, JSON.stringify(evidence));
    assert.ok(spread(evidence.samples.map((sample) => sample.stageHeight)) <= 2, JSON.stringify(evidence));
    assert.ok(spread(evidence.samples.map((sample) => sample.hostHeight)) <= 2, JSON.stringify(evidence));
    assert.ok(spread(evidence.samples.map((sample) => sample.documentHeight)) <= 2, JSON.stringify(evidence));
  }

  assert.equal(result.cycleEvidence.length, 10);
  result.cycleEvidence.forEach(({ expanded, restored }) => {
    assertExpandedLayoutBounded(expanded);
    assert.equal(restored.expanded, false, JSON.stringify(restored));
  });
  const expandedDocumentHeights = result.cycleEvidence.map(({ expanded }) => expanded.documentHeight);
  const restoredDocumentHeights = result.cycleEvidence.map(({ restored }) => restored.documentHeight);
  assert.ok(spread(expandedDocumentHeights) <= 2, JSON.stringify(expandedDocumentHeights));
  assert.ok(spread(restoredDocumentHeights) <= 2, JSON.stringify(restoredDocumentHeights));
  assert.ok(Math.abs(expandedDocumentHeights.at(-1) - expandedDocumentHeights[0]) <= 2, JSON.stringify(expandedDocumentHeights));
  assert.ok(Math.abs(restoredDocumentHeights.at(-1) - restoredDocumentHeights[0]) <= 2, JSON.stringify(restoredDocumentHeights));
  assert.deepEqual(result.finalState.activePages, ['workspace']);
  assert.deepEqual(result.finalState.duplicateIds, []);
  assert.ok(result.apiRequests.includes('/api/session'));
});
