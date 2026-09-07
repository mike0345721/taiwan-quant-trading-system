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

async function removeBrowserProfile(profile) {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
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
      && ((lastState.sessionRequests > 0 && (lastState.loginVisible || lastState.loadErrorVisible))
        || lastState.runtimeErrors.length > 0)) return lastState;
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

async function pressKey(cdp, key, code = key, modifiers = 0) {
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  await waitAnimationFrames(cdp, 3);
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
    drawerOpen: !document.querySelector('.tt-drawer')?.hidden,
    progressiveOpen: Boolean(document.querySelector('.tt-progressive')?.open),
    trendInProgressive: Boolean(document.querySelector('.tt-progressive-body [data-terminal-card="trend"]')),
    visibleFixtureOnly: [...document.querySelectorAll('.tt-fixture-only')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return getComputedStyle(node).display !== 'none' && rect.width > 0 && rect.height > 0;
    }).length,
    visibleMeaninglessDashes: [...(root?.querySelectorAll('*') || [])].filter((node) => {
      const rect = node.getBoundingClientRect();
      const directDash = [...node.childNodes]
        .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === '—');
      return directDash && getComputedStyle(node).display !== 'none'
        && getComputedStyle(node).visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }).map((node) => (node.id || node.className || node.tagName) + ':'
      + (node.parentElement?.id || node.parentElement?.className || node.parentElement?.tagName || '') + ':'
      + (node.parentElement?.textContent || node.textContent).trim()),
    visibleBareUnavailable: [...(root?.querySelectorAll('*') || [])].filter((node) => {
      const rect = node.getBoundingClientRect();
      const directUnavailable = [...node.childNodes]
        .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === 'UNAVAILABLE');
      return directUnavailable && getComputedStyle(node).display !== 'none'
        && getComputedStyle(node).visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }).map((node) => (node.id || node.className || node.tagName) + ':'
      + (node.parentElement?.id || node.parentElement?.className || node.parentElement?.tagName || '') + ':'
      + (node.parentElement?.textContent || node.textContent).trim()),
    copyState: document.getElementById('tt-gpt-disabled-state')?.textContent || '',
    activeElementId: document.activeElement?.id || '',
    activeElementClass: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
    activeDrawerTitle: document.activeElement?.dataset?.terminalDrawerTitle || '',
    drawerText: document.querySelector('.tt-drawer-body')?.textContent || '',
    observedFlowCardScrollTop: document.querySelector('.dw-observed-flow')?.scrollTop || 0,
    observedFlowDetailDisplay: getComputedStyle(document.getElementById('dw-observed-flow-detail')).display,
  };
})()`;

const layoutMeasurementExpression = `(() => {
  const root = document.getElementById('decision-workspace');
  const owner = root?.querySelector('.tt-primary-grid > .dw-price-region');
  const observed = root?.querySelector('.dw-observed-flow');
  const stage = root?.querySelector('.dw-chart-stage');
  const host = root?.querySelector('.dw-chart-canvas');
  const round = (value) => Math.round(value * 100) / 100;
  const coreSelectors = [
    '#tt-top-price', '#tt-top-change', '#tt-top-oi', '#tt-top-basis',
    '#tt-pulse-basis', '#dw-observed-flow-state', '.dw-observed-flow-chain',
    '.dw-observed-flow-trust', '.tt-terminal-topbar', '.tt-primary-grid', '.tt-tier-one-grid',
    '.tt-tier-two-grid', '.tt-tier-three-grid', '.dw-chart-toolbar',
    '.tt-progressive > summary', '.tt-terminal-nav', '.tt-drawer-panel',
  ];
  const clippedCore = coreSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && (rect.left < -1 || rect.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1);
    })
    .map(() => selector));
  const subElevenPixelText = [...(root?.querySelectorAll('*') || [])]
    .filter((node) => {
      if (['CANVAS', 'PATH', 'SCRIPT', 'STYLE'].includes(node.tagName)) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const hasDirectText = [...node.childNodes]
        .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      return hasDirectText && style.display !== 'none' && style.visibility !== 'hidden'
        && rect.width > 0 && rect.height > 0
        && Number.parseFloat(style.fontSize) < 11;
    })
    .map((node) => ({
      tag: node.tagName,
      id: node.id,
      className: typeof node.className === 'string' ? node.className : '',
      fontSize: getComputedStyle(node).fontSize,
    }));
  const ownerRect = owner?.getBoundingClientRect();
  const observedRect = observed?.getBoundingClientRect();
  return {
    expanded: root?.classList.contains('is-chart-expanded') ?? false,
    ownerHeight: round(ownerRect?.height || 0),
    ownerWidth: round(ownerRect?.width || 0),
    observedHeight: round(observedRect?.height || 0),
    observedWidth: round(observedRect?.width || 0),
    visualPrimaryRatio: observedRect?.width && observedRect?.height
      ? round((ownerRect.width * ownerRect.height) / (observedRect.width * observedRect.height))
      : null,
    chartLeadsSupporting: Boolean(ownerRect && observedRect && ownerRect.top <= observedRect.top + 1),
    observedFlowClipped: Boolean(observed && (observed.scrollWidth > observed.clientWidth + 1 || observed.scrollHeight > observed.clientHeight + 1)),
    stageHeight: round(stage?.getBoundingClientRect().height || 0),
    hostHeight: round(host?.getBoundingClientRect().height || 0),
    canvasHeights: [...(host?.querySelectorAll('canvas') || [])].map((canvas) => round(canvas.getBoundingClientRect().height)),
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    clippedCore,
    subElevenPixelText,
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
  assert.equal(sample.horizontalOverflow, false, JSON.stringify(sample));
  assert.deepEqual(sample.clippedCore, [], JSON.stringify(sample));
  assert.deepEqual(sample.subElevenPixelText, [], JSON.stringify(sample));
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
    const blockingConsoleErrors = [];
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (!['error', 'assert'].includes(type)) return;
      blockingConsoleErrors.push(args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
    });
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    await cdp.command('Runtime.evaluate', {
      expression: `window.__ui1SessionRequests = 0;
        window.__ui1RuntimeErrors = [];
        window.addEventListener('error', (event) => {
          window.__ui1RuntimeErrors.push({ message: event.message, stack: event.error?.stack || '' });
        });
        window.fetch = async (input) => {
          const url = new URL(String(input), 'http://ui1.test');
          if (url.pathname === '/api/session') {
            window.__ui1SessionRequests += 1;
            return new Response(JSON.stringify({ authenticated: ${options.dashboardFailure ? 'true' : 'false'}, csrfToken: '' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (${options.postLoginFailure ? 'true' : 'false'} && url.pathname === '/api/auth/login') {
            return new Response(JSON.stringify({ ok: true, csrfToken: 'test-csrf' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (${options.dashboardFailure || options.postLoginFailure ? 'true' : 'false'} && url.pathname === '/api/v1/dashboard') {
            return new Response(JSON.stringify({ ok: false, error: 'GOVERNED_DASHBOARD_FIXTURE_FAILURE' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ data: [] }), {
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
        dashboardVisible: !document.getElementById('dashboard-view')?.classList.contains('hidden'),
        loadErrorVisible: Boolean(document.querySelector('[data-dashboard-load-error="true"]')),
        loadErrorText: document.querySelector('[data-dashboard-load-error="true"]')?.textContent || '',
        dashboardLoadState: root?.dataset.dashboardLoadState || null,
        ambiguousDashes: [...(root?.querySelectorAll('*') || [])].filter((node) =>
          [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === '—')
        ).map((node) => node.id || node.className || node.tagName),
        bareUnavailable: [...(root?.querySelectorAll('*') || [])].filter((node) =>
          [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === 'UNAVAILABLE')
        ).map((node) => node.id || node.className || node.tagName),
        sessionRequests: window.__ui1SessionRequests || 0,
        runtimeErrors: window.__ui1RuntimeErrors || [],
      };
    })()`;
    let pageState = await waitForPageState(cdp, pageStateExpression);
    if (options.postLoginFailure) {
      await evaluate(cdp, `document.getElementById('password').value = 'fixture-passphrase'`);
      await clickSelector(cdp, '#login-form button[type="submit"]');
      pageState = await waitForValue(
        cdp,
        pageStateExpression,
        (value) => value?.loadErrorVisible && value.dashboardLoadState === 'UNAVAILABLE',
        'POST_LOGIN_FAILURE_NOT_VISIBLE',
      );
    }
    return { pageState, exceptions: [...exceptions, ...pageState.runtimeErrors], blockingConsoleErrors };
  } finally {
    pipe.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([
        once(browser, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    await removeBrowserProfile(profile);
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

    const wiringEvidence = await evaluate(cdp, `(() => {
      const availableAt = '2026-08-28T05:45:00.000Z';
      const health = (sourceId, freshnessState) => ({
        sourceId, sourceAvailability: 'SOURCE_AVAILABLE', readinessState: 'READY',
        freshnessState, availableAt,
      });
      state.snapshot = {
        futuresMarket: {
          ok: true, dataDate: '2026-08-28', fetchedAt: availableAt,
          data: { txDay: { contract: '202608', openInterest: 83520 } },
        },
        marketOverview: { ok: true, dataDate: '2026-08-28', fetchedAt: availableAt, data: {} },
        futuresInstitutional: {
          ok: true, dataDate: '2026-08-28', fetchedAt: availableAt,
          data: { foreignNet: -31890, dealerNet: 2140, trustNet: 0 },
        },
        options: {
          ok: true, dataDate: '2026-08-28', fetchedAt: availableAt,
          data: {
            contract: '202608W4', oiPcRatio: 1.25,
            callWall: { strike: 24200 }, putWall: { strike: 23400 }, maxPain: 23800,
          },
        },
        derived: { market: { basis: 12.5 }, futures: { openInterestDelta: -400 } },
      };
      const workspace = {
        globalStatus: { dataHealth: 'DELAYED' },
        decisionSummary: { risk: 'ELEVATED' },
        currentMarketFactSummary: {},
        chatGptCopy: 'IMMUTABLE GOVERNED SNAPSHOT',
        observedFlow: {
          schemaVersion: 'dashboard-observed-flow-v1', sourceState: 'HISTORICAL', unavailableReason: null,
          source: { sourceMode: 'HISTORICAL', tradeDate: '2026-08-28', availableAt, materializedAt: '2026-08-31T23:57:00.000Z' },
          identity: { instrument: 'TX', actualContract: 'TXFI6', tradeDate: '2026-08-28', session: 'DAY', continuityEpoch: 'TX:2', tickSize: 1 },
          windows: {
            primary60s: {
              label: '60s', status: 'QUALITY_INSUFFICIENT', unavailableReason: 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE',
              pressure: { pressureRatio: 0.1888, classifiedCoverage: 0.9794, buyProxyVolume: 85, sellProxyVolume: 58, unknownVolume: 3, classifiedVolume: 143, netAggressiveFlowProxy: 27, unavailableReason: 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE', bestQuoteCrossCheck: { matchedCoverage: 0.87, unavailableVolume: 0 }, conflict: { count: 5, rate: 0.055 } },
              response: { status: 'READY', startPrice: 46428, endPrice: 46450, displacementPoints: 22, displacementTicks: 22, directionRelation: 'PRESSURE_UNAVAILABLE' },
              pathEfficiency: { status: 'READY', value: 0.1089, unavailableReason: null },
            },
            context300s: {
              label: '300s', status: 'QUALITY_INSUFFICIENT', unavailableReason: 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE',
              pressure: { pressureRatio: -0.2208, classifiedCoverage: 0.9827, buyProxyVolume: 598, sellProxyVolume: 937, unknownVolume: 27, classifiedVolume: 1535, netAggressiveFlowProxy: -339, unavailableReason: 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE', bestQuoteCrossCheck: { matchedCoverage: 0.878, unavailableVolume: 0 }, conflict: { count: 48, rate: 0.057 } },
              response: { status: 'READY', startPrice: 46511, endPrice: 46450, displacementPoints: -61, displacementTicks: -61, directionRelation: 'PRESSURE_UNAVAILABLE' },
              pathEfficiency: { status: 'READY', value: 0.0326, unavailableReason: null },
            },
          },
          researchQuality: { status: 'QUALITY_INSUFFICIENT', reasons: ['PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE'] },
          formalDirection: 'NOT_PROMOTED', promotionState: { marketState: 'NOT_PROVIDED' },
          lineage: { cutoffLedgerOrdinal: 163114, cutoffRecordHash: 'a'.repeat(64), maxUsedLedgerOrdinal: 163114, maxUsedRecordHash: 'a'.repeat(64), sourceLedgerIdentity: 'sha256:' + 'b'.repeat(64) },
          artifact: { artifactIdentity: 'cru34-historical-' + 'c'.repeat(64), semanticContentHash: 'd'.repeat(64), artifactHash: 'e'.repeat(64) },
          methodology: { pressure: 'provider classification proxy; UNKNOWN preserved' },
          limitations: ['No trading direction is produced.'],
        },
        evidenceConflict: { evidence: [{
          family: 'PARTICIPATION_BREADTH', availabilityState: 'AVAILABLE', qualityStatus: 'PASS',
          detail: { descriptiveValues: [{ label: '上漲家數', value: 904, unit: ' 家', sourceMode: 'RAW_LIVE' }] },
        }] },
        snapshot: {
          dataHealth: { items: [
            health('chartBar', 'LIVE'), health('txTick', 'LIVE'), health('marketOverview', 'FRESH'),
            health('cashInstitutional', 'DELAYED'), health('futuresPositioning', 'DELAYED'),
            health('futuresMarket', 'DELAYED'), health('optionsEod', 'STALE'),
            health('soxResearchContext', 'DELAYED'), health('taiwanVix', 'STALE'),
          ] },
          breadth: {
            availability: 'AVAILABLE', source: 'breadth', availableAt,
            value: { raise_count: 904, flat_count: 163, fall_count: 711, tradeDate: '2026-08-28' },
          },
        },
      };
      const chart = {
        status: 'READY', source: 'GOVERNED_TX_CHART_FIXTURE', actualContract: '202608',
        tradeDate: '2026-08-28', session: 'DAY', availableAt, qualityStatus: 'PASS',
        lastPrice: 24000, bars: [{ volume: 1200 }],
        levels: {
          previousClose: { availability: 'AVAILABLE', value: 23950, source: 'PREVIOUS_DAY_CLOSE' },
          vwap: { availability: 'AVAILABLE', value: 23980, source: 'SESSION_EXACT_TX_TICK_VWAP' },
        },
      };
      globalThis.__ui1Workspace = workspace;
      globalThis.__ui1Chart = chart;
      renderObservedFlow(workspace.observedFlow);
      renderTerminalShell(workspace, chart);
      renderMarketPulse(workspace, chart);
      dwText('dw-chart-session', chart.tradeDate + ' · ' + chart.session);
      dwText('dw-chart-contract', chart.actualContract);
      dwText('dw-reference-price', fmt(chart.lastPrice));
      dwText('dw-leadership-time', 'UNAVAILABLE · SOURCE_NOT_RUNNING');
      const ids = [
        'tt-top-change', 'tt-top-oi', 'tt-top-basis', 'tt-pulse-basis',
        'tt-futures-vwap', 'tt-futures-basis', 'tt-futures-foreign', 'tt-futures-dealer',
        'tt-futures-trust-position', 'tt-futures-oi', 'tt-futures-oi-change',
        'tt-options-call', 'tt-options-put', 'tt-options-max-pain', 'tt-options-oi',
        'tt-breadth-up', 'tt-breadth-flat', 'tt-breadth-down', 'tt-breadth-ratio',
        'tt-health-market', 'tt-health-institutional', 'tt-health-futures', 'tt-health-options',
        'tt-health-global', 'tt-risk-ring-value', 'tt-risk-volatility', 'tt-risk-liquidity',
        'tt-risk-event', 'tt-risk-breadth',
        'dw-observed-flow-pressure-60', 'dw-observed-flow-response-60', 'dw-observed-flow-path-60',
        'dw-observed-flow-pressure-300', 'dw-observed-flow-response-300', 'dw-observed-flow-path-300',
        'dw-observed-flow-coverage', 'dw-observed-flow-quality', 'dw-observed-flow-source',
        'dw-observed-flow-truth',
      ];
      const evidence = Object.fromEntries(ids.map((id) => {
        const node = document.getElementById(id);
        return [id, { text: node?.textContent || '', title: node?.title || '' }];
      }));
      evidence['dw-observed-flow-semantics'] = {
        text: document.querySelector('.dw-flow-selected-detail')?.textContent || '', title: '',
      };
      renderObservedFlow({ ...workspace.observedFlow, sourceState: 'STALE' });
      evidence['dw-observed-flow-stale-truth'] = {
        text: document.getElementById('dw-observed-flow-truth')?.textContent || '',
        title: document.getElementById('dw-observed-flow-truth')?.className || '',
      };
      renderObservedFlow(workspace.observedFlow);
      renderTerminalShell({ ...workspace, globalStatus: {} }, chart);
      for (const id of ['tt-health-main', 'tt-health-trust']) {
        const node = document.getElementById(id);
        evidence[id + '-missing'] = { text: node?.textContent || '', title: node?.title || '' };
      }
      renderTerminalShell(workspace, chart);
      renderIndexLeadership({ state: 'UNAVAILABLE', reason: 'INDEX_LEADERSHIP_API_UNAVAILABLE', quality: 'QUALITY_INSUFFICIENT' });
      for (const id of ['dw-leadership-state', 'dw-leadership-mode', 'dw-leadership-time']) {
        const node = document.getElementById(id);
        evidence[id] = { text: node?.textContent || '', title: node?.title || '' };
      }
      return evidence;
    })()`);

    const observedFlowStateMatrix = await evaluate(cdp, `(() => {
      const base = structuredClone(globalThis.__ui1Workspace.observedFlow);
      base.sourceState = 'LIVE';
      base.source.sourceMode = 'LIVE';
      const selected = () => ({
        title: document.getElementById('dw-flow-selected-title')?.textContent || '',
        ratio: document.getElementById('dw-flow-selected-ratio')?.textContent || '',
        side: document.getElementById('dw-flow-selected-side')?.textContent || '',
        response: document.getElementById('dw-flow-selected-response')?.textContent || '',
        relation: document.getElementById('dw-flow-selected-relation')?.textContent || '',
        path: document.getElementById('dw-flow-selected-path')?.textContent || '',
        pending: document.getElementById('dw-flow-selected-pending')?.textContent || '',
        pendingVisible: !document.getElementById('dw-flow-selected-pending')?.classList.contains('hidden'),
        barClass: document.getElementById('dw-flow-selected-bar')?.className || '',
        filledCells: document.querySelectorAll('#dw-flow-selected-bar .is-filled').length,
        truthClass: document.getElementById('dw-observed-flow-truth')?.className || '',
        truth: document.getElementById('dw-observed-flow-truth')?.textContent || '',
      });
      const renderPressure = (ratio, coverage, direction) => {
        const value = structuredClone(base);
        Object.assign(value.windows.context300s.pressure, {
          status: coverage === 1 ? 'READY' : 'QUALITY_INSUFFICIENT',
          pressureRatio: ratio, classifiedCoverage: coverage, direction,
        });
        renderObservedFlow(value);
        return selected();
      };
      const pressure = {
        positive: renderPressure(0.42, 1, 'BUY_SIDE'),
        negative: renderPressure(-0.27, 1, 'SELL_SIDE'),
        zero: renderPressure(0, 1, 'BALANCED'),
        null: renderPressure(null, 0, 'UNAVAILABLE'),
        limitedPositive: renderPressure(0.42, 0.96, 'UNAVAILABLE'),
        limitedNegative: renderPressure(-0.27, 0.96, 'UNAVAILABLE'),
      };
      const response = {};
      for (const relation of ['SAME_DIRECTION', 'OPPOSITE_DIRECTION', 'FLAT_PRICE', 'PRESSURE_UNAVAILABLE']) {
        const value = structuredClone(base);
        value.windows.context300s.pressure.status = 'READY';
        value.windows.context300s.pressure.classifiedCoverage = 1;
        value.windows.context300s.pressure.direction = 'BUY_SIDE';
        value.windows.context300s.response.directionRelation = relation;
        renderObservedFlow(value);
        response[relation] = selected().relation;
      }
      const pathUnavailableValue = structuredClone(base);
      pathUnavailableValue.windows.context300s.pathEfficiency = {
        status: 'QUALITY_INSUFFICIENT', value: null,
        unavailableReason: 'QUALITY_INSUFFICIENT_LONG_GAP',
      };
      renderObservedFlow(pathUnavailableValue);
      const pathUnavailable = selected().path;
      document.querySelector('[data-flow-window="1m"]').click();
      const selected1m = selected();
      document.querySelector('[data-flow-window="15m"]').click();
      const selected15m = selected();
      document.querySelector('[data-flow-window="5m"]').click();
      const selected5m = selected();
      const chartSelectionAfterFlow = document.querySelector('[data-chart-timeframe].is-selected')?.dataset.chartTimeframe;
      renderObservedFlow(base);
      const live = selected();
      renderObservedFlow({ ...base, sourceState: 'STALE' });
      const stale = selected();
      renderObservedFlow({ ...base, sourceState: 'WARMING_UP' });
      const warming = selected();
      renderObservedFlow({ ...base, sourceState: 'HISTORICAL' });
      const historical = selected();
      renderObservedFlow({ sourceState: 'UNAVAILABLE', unavailableReason: 'FIXTURE_UNAVAILABLE', windows: null });
      const unavailable = selected();
      renderObservedFlow(globalThis.__ui1Workspace.observedFlow);
      return { pressure, response, pathUnavailable, selected1m, selected15m, selected5m,
        chartSelectionAfterFlow, live, stale, warming, historical, unavailable };
    })()`);

    const refreshFailureEvidence = await evaluate(cdp, `(() => {
      const pulseIds = [
        'dw-pulse-price', 'dw-pulse-vwap', 'dw-pulse-session', 'dw-pulse-breadth',
        'dw-pulse-futures', 'dw-pulse-options', 'dw-pulse-global', 'dw-pulse-change',
        'dw-pulse-volume', 'dw-pulse-vwap-mode', 'dw-pulse-breadth-mode',
        'dw-pulse-futures-mode', 'dw-pulse-options-mode', 'dw-pulse-global-mode',
      ];
      const pulseBeforeFailure = {
        price: document.getElementById('dw-pulse-price')?.textContent || '',
        basis: document.getElementById('tt-pulse-basis')?.textContent || '',
        breadth: document.getElementById('dw-pulse-breadth')?.textContent || '',
      };
      renderTerminalDashboardFailure('DASHBOARD_REFRESH:GOVERNED_DASHBOARD_FIXTURE_FAILURE');
      state.txChartApi = window.__ui1LayoutChart;
      renderTxDecisionChart(globalThis.__ui1Chart);
      const root = document.getElementById('decision-workspace');
      const result = {
        pulseBeforeFailure,
        loadState: root.dataset.dashboardLoadState,
        topPrice: document.getElementById('tt-top-price')?.textContent || '',
        pulsePrice: document.getElementById('dw-pulse-price')?.textContent || '',
        pulseBasis: document.getElementById('tt-pulse-basis')?.textContent || '',
        pulseAfterFailure: Object.fromEntries(pulseIds.map((id) => [id, document.getElementById(id)?.textContent || ''])),
        observedAfterFailure: Object.fromEntries([
          'dw-observed-flow-state', 'dw-observed-flow-pressure-60', 'dw-observed-flow-response-60',
          'dw-observed-flow-path-60', 'dw-observed-flow-pressure-300', 'dw-observed-flow-response-300',
          'dw-observed-flow-path-300', 'dw-observed-flow-coverage', 'dw-observed-flow-quality',
          'dw-observed-flow-source', 'dw-observed-flow-truth',
        ].map((id) => [id, document.getElementById(id)?.textContent || ''])),
        observedDetail: document.getElementById('dw-observed-flow-detail')?.textContent || '',
        copyDisabled: document.getElementById('dw-copy-gpt-prompt')?.disabled,
      };
      root.dataset.dashboardLoadState = 'LOADING';
      renderTerminalShell(globalThis.__ui1Workspace, globalThis.__ui1Chart);
      root.dataset.dashboardLoadState = 'READY';
      return result;
    })()`);

    const leadershipRefreshFailureEvidence = await evaluate(cdp, `(() => {
      renderIndexLeadership({
        state: 'LIVE', sourceMode: 'LEDGER_LATEST', sourceTradeDate: '2026-08-28',
        lastAvailableAt: '2026-08-28T05:30:00.000Z', quality: 'QUALITY_SUFFICIENT',
        indexLeadership: {
          topAbsolute: [{ code: '2330', points: 18.5 }],
          topPositive: [{ code: '2330', points: 18.5 }],
          topNegative: [{ code: '2317', points: -2.5 }],
        },
        industryLeadership: { rows: [{ category: '半導體', points: 12.25 }] },
      });
      const before = {
        state: document.getElementById('dw-leadership-state')?.textContent || '',
        bars: document.getElementById('dw-leadership-bars')?.textContent || '',
      };
      renderIndexLeadershipFailure(new Error('GOVERNED_INDEX_LEADERSHIP_FAILURE'));
      return {
        before,
        state: document.getElementById('dw-leadership-state')?.textContent || '',
        bars: document.getElementById('dw-leadership-bars')?.textContent || '',
      };
    })()`);

    await evaluate(cdp, 'renderObservedFlow(globalThis.__ui1Workspace.observedFlow)');
    await clickSelector(cdp, '[data-terminal-card="observed-flow"] > .tt-more');
    const drawerOpened = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.drawerOpen,
      'DRAWER_OPEN_FAILED',
    );
    const drawerOpenLayout = await evaluate(cdp, layoutMeasurementExpression);
    await pressKey(cdp, 'Tab', 'Tab');
    const drawerForwardLoop = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.activeElementClass.includes('tt-drawer-scrim'),
      'DRAWER_FORWARD_FOCUS_LOOP_FAILED',
    );
    await pressKey(cdp, 'Tab', 'Tab', 8);
    const drawerReverseLoop = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.activeElementClass.includes('tt-drawer-close'),
      'DRAWER_REVERSE_FOCUS_LOOP_FAILED',
    );
    await pressKey(cdp, 'Escape', 'Escape');
    const drawerClosed = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value && !value.drawerOpen,
      'DRAWER_ESCAPE_CLOSE_FAILED',
    );
    await clickSelector(cdp, '.tt-progressive > summary');
    const progressiveOpened = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value?.progressiveOpen && value.trendInProgressive,
      'PROGRESSIVE_DISCLOSURE_OPEN_FAILED',
    );
    const progressiveOpenLayout = await evaluate(cdp, layoutMeasurementExpression);
    await clickSelector(cdp, '.tt-progressive > summary');
    const progressiveClosed = await waitForValue(
      cdp,
      interactiveStateExpression,
      (value) => value && !value.progressiveOpen,
      'PROGRESSIVE_DISCLOSURE_CLOSE_FAILED',
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

    const defaultViewportEvidence = [];
    for (const [width, height] of [[1920, 1080], [1680, 900], [1536, 864], [1440, 900], [1366, 768]]) {
      await setViewport(cdp, width, height);
      defaultViewportEvidence.push({ width, height, samples: await stableLayoutSamples(cdp, 6) });
    }

    const resizeSweepEvidence = [];
    for (const width of [1920, 1840, 1760, 1680, 1600, 1536, 1480, 1440, 1400, 1366]) {
      await setViewport(cdp, width, width === 1920 ? 1080 : width === 1366 ? 768 : 900);
      resizeSweepEvidence.push({ width, sample: (await stableLayoutSamples(cdp, 3)).at(-1) });
    }

    await clickSelector(cdp, '#tt-chart-expand');
    await waitForValue(
      cdp,
      layoutMeasurementExpression,
      (value) => value?.expanded,
      'CHART_EXPAND_FAILED',
    );
    const viewportEvidence = [];
    for (const [width, height] of [[1920, 1080], [1680, 900], [1536, 864], [1440, 900], [1366, 768]]) {
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
      wiringEvidence,
      observedFlowStateMatrix,
      refreshFailureEvidence,
      leadershipRefreshFailureEvidence,
      drawerEvidence: { opened: drawerOpened, openLayout: drawerOpenLayout, forwardLoop: drawerForwardLoop, reverseLoop: drawerReverseLoop, closed: drawerClosed },
      progressiveEvidence: { opened: progressiveOpened, openLayout: progressiveOpenLayout, closed: progressiveClosed },
      routeStates,
      defaultViewportEvidence,
      resizeSweepEvidence,
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
    await removeBrowserProfile(profile);
  }
}

async function runRealRuntimeDom({ baseUrl, password, screenshotPath }) {
  const binary = browserBinary();
  assert.ok(binary, 'Chrome or Edge is required for real-runtime DOM acceptance');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cru31-real-runtime-dom-'));
  const browser = spawn(binary, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-extensions',
    '--disable-background-networking', '--no-proxy-server', '--no-first-run', '--no-default-browser-check',
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
    await cdp.command('Network.enable');
    await cdp.command('Network.setBlockedURLs', { urls: ['*://*.kaspersky-labs.com/*'] });
    await setViewport(cdp, 1536, 864);
    const navigation = await cdp.command('Page.navigate', { url: `${baseUrl}/` });
    if (navigation.errorText) throw new Error(`REAL_RUNTIME_NAVIGATION_FAILED:${navigation.errorText}`);
    await waitForValue(cdp, `(() => ({
      ready: document.readyState,
      url: location.href,
      html: document.documentElement?.outerHTML?.slice(0, 500) || '',
      login: Boolean(document.getElementById('password'))
        && !document.getElementById('login-view')?.classList.contains('hidden'),
    }))()`, (value) => value?.login, 'REAL_RUNTIME_LOGIN_NOT_VISIBLE');
    await evaluate(cdp, `(() => {
      document.getElementById('password').value = ${JSON.stringify(password)};
      document.getElementById('login-form').requestSubmit();
      return true;
    })()`);
    await waitForValue(cdp, `(() => ({
      dashboard: !document.getElementById('dashboard-view')?.classList.contains('hidden'),
      state: document.getElementById('decision-workspace')?.dataset.dashboardLoadState || null,
    }))()`, (value) => value?.dashboard && ['READY', 'UNAVAILABLE'].includes(value.state), 'REAL_RUNTIME_DASHBOARD_NOT_SETTLED');
    await waitAnimationFrames(cdp, 4);
    const evidence = await evaluate(cdp, `(() => {
      const root = document.getElementById('decision-workspace');
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      const directTextMatches = (expected) => [...root.querySelectorAll('*')].filter((node) => visible(node)
        && [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim() === expected))
        .map((node) => node.id || node.className || node.tagName).slice(0, 30);
      const subElevenPixelText = [...root.querySelectorAll('button, span, small, code, p, li, label, summary')]
        .filter((node) => visible(node) && Number.parseFloat(getComputedStyle(node).fontSize) < 11)
        .map((node) => ({ id: node.id, className: node.className, size: getComputedStyle(node).fontSize })).slice(0, 30);
      const text = (id) => document.getElementById(id)?.textContent?.trim() || null;
      return {
        observedAt: new Date().toISOString(),
        route: location.href,
        viewport: [innerWidth, innerHeight],
        loadState: root?.dataset.dashboardLoadState || null,
        alert: document.querySelector('[data-dashboard-load-error="true"]')?.textContent || null,
        duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        clippedCore: [
          '#tt-top-price', '#tt-top-change', '#tt-top-oi', '#tt-top-basis', '#tt-pulse-basis',
          '.tt-terminal-topbar', '.tt-primary-grid', '.tt-tier-one-grid', '.tt-tier-two-grid',
          '.tt-tier-three-grid', '.dw-chart-toolbar', '.tt-progressive > summary', '.tt-terminal-nav',
        ].flatMap((selector) => [...document.querySelectorAll(selector)].filter((node) => {
          const rect = node.getBoundingClientRect();
          return visible(node) && (rect.left < -1 || rect.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1);
        }).map(() => selector)),
        overflowingElements: [...document.querySelectorAll('body *')].filter((node) => {
          if (!visible(node)) return false;
          const rect = node.getBoundingClientRect();
          return rect.right > innerWidth + 1 || rect.left < -1 || node.scrollWidth > node.clientWidth + 1;
        }).map((node) => ({
          id: node.id, className: String(node.className || ''),
          left: Math.round(node.getBoundingClientRect().left), right: Math.round(node.getBoundingClientRect().right),
          clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
        })).slice(0, 40),
        visibleMeaninglessDashes: directTextMatches('—'),
        visibleBareUnavailable: directTextMatches('UNAVAILABLE'),
        subElevenPixelText,
        chartCanvasCount: document.querySelectorAll('#dw-chart-canvas canvas').length,
        identity: {
          contract: text('tt-top-contract'), session: text('tt-top-session'), updated: text('tt-top-updated'), trust: text('tt-top-trust'),
          chartContract: text('dw-chart-contract'), chartSession: text('dw-chart-session'), chartAvailableAt: text('dw-chart-available-at'), chartQuality: text('dw-chart-quality'),
        },
        surfaces: {
          price: text('tt-top-price'), pulse: text('dw-pulse-price'), futures: text('tt-futures-main'), options: text('tt-options-main'),
          breadth: text('tt-breadth-main'), contribution: text('dw-leadership-state'), global: text('tt-global-main'),
          health: text('tt-health-main'), risk: text('tt-risk-ring-state'), copy: text('tt-gpt-disabled-state'), trend: text('tt-summary-strength'),
        },
        safetyLabelPresent: root?.textContent?.includes('READ ONLY') && root?.textContent?.includes('NOT A TRADING SIGNAL') || false,
      };
    })()`);
    if (screenshotPath) {
      const screenshot = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    }
    return { evidence, exceptions, blockingConsoleErrors, screenshotPath };
  } finally {
    pipe.close();
    if (browser.exitCode === null) {
      browser.kill();
      await Promise.race([once(browser, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await removeBrowserProfile(profile);
  }
}

test('production DOM mounts Trader Terminal and reaches session initialization without blocking exceptions', async () => {
  const result = await runProductionDom();
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.blockingConsoleErrors, []);
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
  assert.deepEqual(result.blockingConsoleErrors, []);
  assert.equal(result.pageState.sessionRequests, 1, JSON.stringify(result));
  assert.equal(result.pageState.mounted, true);
  assert.equal(result.pageState.trendCount, 0);
  assert.equal(result.pageState.changeCount, 0);
  assert.deepEqual(result.pageState.duplicateIds, []);
  assert.equal(result.pageState.loginPresent, true);
  assert.equal(result.pageState.loginVisible, true);
});

test('authenticated dashboard API failure remains visible and is not misreported as logout', async () => {
  const result = await runProductionDom({ dashboardFailure: true });
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.pageState.sessionRequests, 1, JSON.stringify(result));
  assert.equal(result.pageState.mounted, true);
  assert.equal(result.pageState.dashboardVisible, true);
  assert.equal(result.pageState.loginVisible, false);
  assert.equal(result.pageState.loadErrorVisible, true);
  assert.match(result.pageState.loadErrorText, /INITIAL_DASHBOARD_LOAD/);
  assert.match(result.pageState.loadErrorText, /GOVERNED_DASHBOARD_FIXTURE_FAILURE/);
  assert.equal(result.pageState.dashboardLoadState, 'UNAVAILABLE');
  assert.deepEqual(result.pageState.ambiguousDashes, []);
  assert.deepEqual(result.pageState.bareUnavailable, []);
  assert.equal(result.blockingConsoleErrors.length, 1, JSON.stringify(result.blockingConsoleErrors));
  assert.match(result.blockingConsoleErrors[0], /INITIAL_DASHBOARD_LOAD/);
});

test('post-login dashboard API failure remains visible and normalizes the terminal shell', async () => {
  const result = await runProductionDom({ postLoginFailure: true });
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.pageState.dashboardVisible, true);
  assert.equal(result.pageState.loginVisible, false);
  assert.equal(result.pageState.loadErrorVisible, true);
  assert.match(result.pageState.loadErrorText, /POST_LOGIN_DASHBOARD_LOAD/);
  assert.equal(result.pageState.dashboardLoadState, 'UNAVAILABLE');
  assert.deepEqual(result.pageState.ambiguousDashes, []);
  assert.deepEqual(result.pageState.bareUnavailable, []);
  assert.equal(result.blockingConsoleErrors.length, 1, JSON.stringify(result.blockingConsoleErrors));
  assert.match(result.blockingConsoleErrors[0], /POST_LOGIN_DASHBOARD_LOAD/);
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
  assert.equal(result.initialState.trendInProgressive, true);
  assert.equal(result.initialState.visibleFixtureOnly, 0);

  for (const [id, evidence] of Object.entries(result.wiringEvidence)) {
    assert.ok(evidence.text && evidence.text !== '—', `${id}:${JSON.stringify(evidence)}`);
    if (evidence.text.startsWith('UNAVAILABLE')) {
      assert.match(evidence.text, /^UNAVAILABLE · [A-Z0-9_]+$/, `${id}:${JSON.stringify(evidence)}`);
    }
  }
  assert.match(result.wiringEvidence['tt-top-change'].text, /50\.00/);
  assert.match(result.wiringEvidence['tt-top-oi'].text, /83,520 口 · EOD · DELAYED/);
  assert.match(result.wiringEvidence['tt-options-oi'].text, /1\.25 P\/C · EOD · STALE/);
  assert.equal(result.wiringEvidence['tt-futures-trust-position'].text, '0 口 · EOD · DELAYED');
  assert.match(result.wiringEvidence['tt-breadth-flat'].text, /163/);
  assert.equal(result.wiringEvidence['tt-risk-ring-value'].text, 'ELEVATED');
  assert.equal(result.wiringEvidence['tt-risk-volatility'].text, 'UNAVAILABLE · BREAKDOWN_NOT_IMPLEMENTED');
  assert.match(result.wiringEvidence['dw-observed-flow-truth'].text, /HISTORICAL · 2026-08-28/);
  assert.match(result.wiringEvidence['dw-observed-flow-truth'].text, /非目前盤勢/);
  assert.match(result.wiringEvidence['dw-observed-flow-truth'].text, /TXFI6 · DAY/);
  assert.match(result.wiringEvidence['dw-observed-flow-semantics'].text, /成交力道｜誰比較主動/);
  assert.match(result.wiringEvidence['dw-observed-flow-semantics'].text, /價格反應｜價格有沒有跟上/);
  assert.match(result.wiringEvidence['dw-observed-flow-semantics'].text, /路徑效率｜走勢乾不乾淨/);
  assert.match(result.wiringEvidence['dw-observed-flow-stale-truth'].text, /STALE · 2026-08-28/);
  assert.match(result.wiringEvidence['dw-observed-flow-stale-truth'].text, /資料過舊 · STALE/);
  assert.match(result.wiringEvidence['dw-observed-flow-stale-truth'].title, /is-stale/);
  const matrix = result.observedFlowStateMatrix;
  assert.match(matrix.pressure.positive.ratio, /\+0\.420/);
  assert.equal(matrix.pressure.positive.side, '偏買方');
  assert.match(matrix.pressure.positive.barClass, /is-positive/);
  assert.equal(matrix.pressure.positive.filledCells, 3);
  assert.match(matrix.pressure.negative.ratio, /-0\.270/);
  assert.equal(matrix.pressure.negative.side, '偏賣方');
  assert.match(matrix.pressure.negative.barClass, /is-negative/);
  assert.equal(matrix.pressure.zero.ratio, '0.000');
  assert.equal(matrix.pressure.zero.side, '均衡');
  assert.equal(matrix.pressure.null.ratio, '不可判定');
  assert.doesNotMatch(matrix.pressure.null.ratio, /0\.000/);
  assert.equal(matrix.pressure.limitedPositive.side, '方向判定受限');
  assert.match(matrix.pressure.limitedPositive.barClass, /is-positive.*is-limited/);
  assert.equal(matrix.pressure.limitedNegative.side, '方向判定受限');
  assert.match(matrix.pressure.limitedNegative.barClass, /is-negative.*is-limited/);
  assert.deepEqual(matrix.response, {
    SAME_DIRECTION: '同方向反應', OPPOSITE_DIRECTION: '反方向反應',
    FLAT_PRICE: '價格持平', PRESSURE_UNAVAILABLE: '成交力道不可判定',
  });
  assert.match(matrix.pathUnavailable, /QUALITY_INSUFFICIENT_LONG_GAP/);
  assert.equal(matrix.selected1m.title, '1分');
  assert.equal(matrix.selected15m.title, '15分');
  assert.equal(matrix.selected15m.pendingVisible, true);
  assert.match(matrix.selected15m.pending, /CRU-44 尚未啟用/);
  assert.equal(matrix.selected5m.title, '5分');
  assert.equal(matrix.selected5m.pendingVisible, false);
  assert.equal(matrix.chartSelectionAfterFlow, '5m');
  assert.match(matrix.live.barClass, /is-negative/);
  assert.doesNotMatch(matrix.live.barClass, /is-inactive/);
  assert.match(matrix.stale.barClass, /is-inactive/);
  assert.match(matrix.stale.truthClass, /is-stale/);
  assert.match(matrix.warming.truth, /暖機中/);
  assert.match(matrix.historical.truth, /歷史資料｜非目前盤勢/);
  assert.match(matrix.unavailable.truth, /FIXTURE_UNAVAILABLE/);
  assert.match(result.refreshFailureEvidence.pulseBeforeFailure.price, /24,000/);
  assert.match(result.refreshFailureEvidence.pulseBeforeFailure.basis, /12\.50/);
  assert.match(result.refreshFailureEvidence.pulseBeforeFailure.breadth, /904/);
  assert.equal(result.refreshFailureEvidence.loadState, 'UNAVAILABLE');
  assert.match(result.refreshFailureEvidence.topPrice, /UNAVAILABLE · DASHBOARD_REFRESH/);
  assert.match(result.refreshFailureEvidence.pulsePrice, /UNAVAILABLE · DASHBOARD_REFRESH/);
  assert.match(result.refreshFailureEvidence.pulseBasis, /UNAVAILABLE · DASHBOARD_REFRESH/);
  for (const [id, value] of Object.entries(result.refreshFailureEvidence.pulseAfterFailure)) {
    assert.match(value, /UNAVAILABLE · DASHBOARD_REFRESH/, `${id}:${value}`);
  }
  assert.equal(result.refreshFailureEvidence.copyDisabled, true);
  for (const [id, value] of Object.entries(result.refreshFailureEvidence.observedAfterFailure)) {
    assert.match(value, /UNAVAILABLE .* DASHBOARD_REFRESH/, `${id}:${value}`);
  }
  assert.match(result.refreshFailureEvidence.observedDetail, /證據不可用/);
  assert.match(result.refreshFailureEvidence.observedDetail, /DASHBOARD_REFRESH:GOVERNED_DASHBOARD_FIXTURE_FAILURE/);
  assert.doesNotMatch(result.refreshFailureEvidence.observedDetail, /主動買方代理量/);
  assert.equal(result.leadershipRefreshFailureEvidence.before.state, 'LIVE');
  assert.match(result.leadershipRefreshFailureEvidence.before.bars, /2330/);
  assert.match(result.leadershipRefreshFailureEvidence.state, /UNAVAILABLE · INDEX_LEADERSHIP_API_UNAVAILABLE/);
  assert.match(result.leadershipRefreshFailureEvidence.bars, /UNAVAILABLE · INDEX_LEADERSHIP_API_UNAVAILABLE/);
  assert.doesNotMatch(result.leadershipRefreshFailureEvidence.bars, /2330/);
  assert.equal(result.drawerEvidence.opened.drawerOpen, true);
  assert.match(result.drawerEvidence.opened.drawerText, /主動買方代理量/);
  assert.match(result.drawerEvidence.opened.drawerText, /PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE/);
  assert.match(result.drawerEvidence.opened.drawerText, /NOT_PROMOTED/);
  assert.deepEqual(result.drawerEvidence.openLayout.clippedCore, []);
  assert.deepEqual(result.drawerEvidence.openLayout.subElevenPixelText, []);
  assert.deepEqual(result.drawerEvidence.opened.visibleMeaninglessDashes, []);
  assert.deepEqual(result.drawerEvidence.opened.visibleBareUnavailable, []);
  assert.match(result.drawerEvidence.forwardLoop.activeElementClass, /tt-drawer-scrim/);
  assert.match(result.drawerEvidence.reverseLoop.activeElementClass, /tt-drawer-close/);
  assert.equal(result.drawerEvidence.closed.drawerOpen, false);
  assert.equal(result.drawerEvidence.closed.activeDrawerTitle, '台指期盤中力道｜證據');
  assert.equal(result.drawerEvidence.closed.observedFlowCardScrollTop, 0);
  assert.equal(result.drawerEvidence.closed.observedFlowDetailDisplay, 'none');
  assert.equal(result.progressiveEvidence.opened.progressiveOpen, true);
  assert.equal(result.progressiveEvidence.opened.trendInProgressive, true);
  assert.deepEqual(result.progressiveEvidence.opened.visibleMeaninglessDashes, []);
  assert.deepEqual(result.progressiveEvidence.opened.visibleBareUnavailable, []);
  assert.deepEqual(result.progressiveEvidence.openLayout.clippedCore, []);
  assert.deepEqual(result.progressiveEvidence.openLayout.subElevenPixelText, []);
  assert.equal(result.progressiveEvidence.closed.progressiveOpen, false);
  assert.deepEqual(result.progressiveEvidence.closed.visibleMeaninglessDashes, []);
  assert.equal(result.progressiveEvidence.closed.copyState, 'COPY SNAPSHOT · READY');

  assert.equal(result.routeStates.length, 7);
  result.routeStates.forEach((state, index) => {
    assert.deepEqual(state.activePages, [['workspace', 'today', 'market', 'options', 'intraday', 'research', 'quality'][index]]);
    assert.deepEqual(state.duplicateIds, []);
  });

  assert.deepEqual(result.viewportEvidence.map(({ width, height }) => [width, height]), [
    [1920, 1080], [1680, 900], [1536, 864], [1440, 900], [1366, 768],
  ]);
  for (const evidence of result.viewportEvidence) {
    evidence.samples.forEach(assertExpandedLayoutBounded);
    assert.ok(spread(evidence.samples.map((sample) => sample.ownerHeight)) <= 2, JSON.stringify(evidence));
    assert.ok(spread(evidence.samples.map((sample) => sample.stageHeight)) <= 2, JSON.stringify(evidence));
    assert.ok(spread(evidence.samples.map((sample) => sample.hostHeight)) <= 2, JSON.stringify(evidence));
    assert.ok(spread(evidence.samples.map((sample) => sample.documentHeight)) <= 2, JSON.stringify(evidence));
  }

  for (const item of result.defaultViewportEvidence) {
    for (const sample of item.samples) {
      assert.equal(sample.expanded, false, JSON.stringify(sample));
      assert.equal(sample.horizontalOverflow, false, JSON.stringify(sample));
      assert.deepEqual(sample.clippedCore, [], JSON.stringify(sample));
      assert.deepEqual(sample.subElevenPixelText, [], JSON.stringify(sample));
      assert.equal(sample.chartLeadsSupporting, true, JSON.stringify(sample));
      assert.ok(sample.visualPrimaryRatio >= 1.8, JSON.stringify(sample));
      assert.equal(sample.observedFlowClipped, false, JSON.stringify(sample));
    }
  }

  assert.deepEqual(result.resizeSweepEvidence.map(({ width }) => width), [
    1920, 1840, 1760, 1680, 1600, 1536, 1480, 1440, 1400, 1366,
  ]);
  for (const { sample } of result.resizeSweepEvidence) {
    assert.equal(sample.expanded, false, JSON.stringify(sample));
    assert.equal(sample.horizontalOverflow, false, JSON.stringify(sample));
    assert.deepEqual(sample.clippedCore, [], JSON.stringify(sample));
    assert.deepEqual(sample.subElevenPixelText, [], JSON.stringify(sample));
    assert.equal(sample.chartLeadsSupporting, true, JSON.stringify(sample));
    assert.ok(sample.visualPrimaryRatio >= 1.8, JSON.stringify(sample));
    assert.equal(sample.observedFlowClipped, false, JSON.stringify(sample));
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

test('optional MOCK_DATA=0 local production runtime exposes a truthful authenticated DOM', {
  timeout: 120_000,
  skip: !process.env.CRU31_REAL_RUNTIME_URL || !process.env.CRU31_REAL_RUNTIME_PASSWORD,
}, async () => {
  const result = await runRealRuntimeDom({
    baseUrl: process.env.CRU31_REAL_RUNTIME_URL.replace(/\/$/, ''),
    password: process.env.CRU31_REAL_RUNTIME_PASSWORD,
    screenshotPath: process.env.CRU31_REAL_RUNTIME_SCREENSHOT || null,
  });
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.blockingConsoleErrors, []);
  assert.equal(result.evidence.loadState, 'READY', JSON.stringify(result));
  assert.equal(result.evidence.alert, null, JSON.stringify(result));
  assert.deepEqual(result.evidence.viewport, [1536, 864]);
  assert.deepEqual(result.evidence.duplicateIds, []);
  assert.equal(result.evidence.horizontalOverflow, false, JSON.stringify(result.evidence));
  assert.deepEqual(result.evidence.clippedCore, [], JSON.stringify(result.evidence));
  assert.deepEqual(result.evidence.visibleMeaninglessDashes, []);
  assert.deepEqual(result.evidence.visibleBareUnavailable, []);
  assert.deepEqual(result.evidence.subElevenPixelText, []);
  assert.ok(result.evidence.chartCanvasCount > 0, JSON.stringify(result.evidence));
  assert.equal(result.evidence.safetyLabelPresent, true);
  console.log(`CRU31_REAL_RUNTIME_EVIDENCE ${JSON.stringify(result)}`);
});
