import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/trader-terminal-shell.css', import.meta.url), 'utf8');
function element() {
  return {
    className: '', dataset: {}, children: [],
    replaceChildren(...children) { this.children = children; },
    classList: { toggle() {} },
  };
}
const context = vm.createContext({ document: { createElement: element } });
for (const name of ['observedFlowDisplayCells', 'observedFlowRawSign', 'observedFlowMagnitudeAvailable', 'renderObservedFlowSegments']) {
  const source = app.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(source, name);
  vm.runInContext(source, context);
}

test('CRU58 frozen cell boundaries are independent of raw positive/negative sign', () => {
  for (const [magnitude, cells] of [[0, 0], [0.064, 0], [0.099, 0], [0.1, 1], [0.2, 1],
    [0.324, 1], [0.325, 2], [0.549, 2], [0.55, 3], [0.774, 3], [0.775, 4], [1, 4]]) {
    for (const multiplier of [-1, 1]) {
      const ratio = magnitude * multiplier;
      const host = element();
      context.renderObservedFlowSegments(host, ratio);
      assert.equal(context.observedFlowDisplayCells(ratio), cells);
      assert.equal(host.dataset.displayCells, String(cells));
      assert.equal(host.children.filter(node => node.className.includes('is-filled')).length, cells);
      assert.equal(host.dataset.rawSign, ratio > 0 ? 'positive' : ratio < 0 ? 'negative' : 'neutral');
      assert.equal(host.dataset.rawRatio, String(ratio));
    }
  }
});

test('CRU58 unavailable values and explicitly inactive states have no directional accent', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, -1.01, 1.01]) {
    const host = element();
    context.renderObservedFlowSegments(host, value);
    assert.equal(host.dataset.rawSign, 'unavailable');
    assert.equal(host.dataset.displayCells, '0');
  }
  const host = element();
  context.renderObservedFlowSegments(host, -0.064, { inactive: true });
  assert.equal(host.dataset.rawSign, 'unavailable');
  context.observedFlowRawSign(host, -6);
  assert.equal(host.dataset.rawSign, 'negative');
  context.observedFlowRawSign(host, null);
  assert.equal(host.dataset.rawSign, 'unavailable');
});

test('CRU58 stale and historical legality is separate from warming and unavailable states', () => {
  for (const sourceState of ['LIVE', 'STALE', 'HISTORICAL', 'WARMING_UP', 'UNAVAILABLE', 'UNKNOWN']) {
    for (const truthState of ['LIVE', 'STALE', 'HISTORICAL', 'WARMING_UP', 'UNAVAILABLE', undefined]) {
      const expected = ['LIVE', 'STALE', 'HISTORICAL'].includes(sourceState)
        && ['LIVE', 'STALE', 'HISTORICAL', undefined].includes(truthState);
      assert.equal(context.observedFlowMagnitudeAvailable({ sourceState }, { truthState }, true), expected);
      assert.equal(context.observedFlowMagnitudeAvailable({ sourceState }, { truthState }, false), false);
    }
  }
});

test('CRU58 limitation is an outline rather than diminished magnitude opacity', () => {
  assert.doesNotMatch(css, /is-limited[^{}]*\{[^}]*opacity/);
  assert.match(css, /\.dw-pressure-segments\.is-limited \{ outline: 1px dashed/);
  assert.match(css, /\.dw-flow-metric-energy\.is-limited \{ border: 1px dashed/);
});
