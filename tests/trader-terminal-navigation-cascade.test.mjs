import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Static cascade fixture for the actual formal DOM classes reported at 831px.
// This checks the conflicting grid declarations, not browser geometry or proof.
const read = file => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const assets = [...read('index.html').matchAll(/<link\s+rel="stylesheet"\s+href="\/([^"?]+)(?:\?[^\"]*)?"/g)].map(m => m[1]);
const styles = assets.map(file => ({ file, css: read(file) }));
function rules(css, width) {
  const out = [];
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let cursor = 0; cursor < css.length;) {
    const open = css.indexOf('{', cursor);
    if (open < 0) break;
    const header = css.slice(cursor, open).trim();
    let end = open + 1, depth = 1;
    for (; end < css.length && depth; end++) {
      if (css[end] === '{') depth++;
      if (css[end] === '}') depth--;
    }
    assert.equal(depth, 0, 'balanced stylesheet fixture');
    const body = css.slice(open + 1, end - 1);
    if (header.startsWith('@media')) {
      const limits = [...header.matchAll(/(min|max)-width:\s*(\d+)px/g)];
      if (limits.length && limits.every(([, kind, bound]) => kind === 'max' ? width <= +bound : width >= +bound)) out.push(...rules(body, width));
    } else if (!header.startsWith('@')) {
      const declarations = Object.fromEntries(body.split(';').filter(v => v.includes(':')).map(v => {
        const colon = v.indexOf(':'); return [v.slice(0, colon).trim(), v.slice(colon + 1).trim().replace(/\s+/g, '')];
      }));
      for (const selector of header.split(',')) out.push({ selector: selector.trim(), declarations });
    }
    cursor = end;
  }
  return out;
}
function matches(selector, chain) {
  const parts = selector.split(/\s+/);
  // Only class compounds and descendants apply to the known layout/nav fixture.
  if (!parts.every(part => /^(?:\.[\w-]+)+$/.test(part))) return false;
  let position = chain.length - 1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const classes = parts[i].slice(1).split('.');
    if (i === parts.length - 1 && !classes.every(c => chain[position].includes(c))) return false;
    while (position >= 0 && !classes.every(c => chain[position].includes(c))) position--;
    if (position < 0) return false;
    position--;
  }
  return true;
}
function computed(source, width, chain, property) {
  let winner = null;
  for (const { css } of source) for (const rule of rules(css, width)) {
    if (!matches(rule.selector, chain) || !(property in rule.declarations)) continue;
    const specificity = (rule.selector.match(/\./g) || []).length;
    if (!winner || specificity >= winner.specificity) winner = { specificity, value: rule.declarations[property], selector: rule.selector };
  }
  return winner?.value;
}
const layout = collapsed => ['workspace-layout', 'tt-terminal-layout', ...(collapsed ? ['is-nav-collapsed'] : [])];
const nav = ['side-nav', 'tt-terminal-nav'];

test('fixture reproduces the shared 130px tracks behind the observed 831px navigation hit failure', () => {
  const base = styles.filter(s => s.file === 'styles.css');
  assert.equal(computed(base, 831, [layout(true), nav], 'grid-template-columns'), 'repeat(5,minmax(130px,1fr))');
  assert.equal(computed(styles, 831, [layout(true)], 'grid-template-columns'), '64pxminmax(0,1fr)');
  assert.ok(130 > 64, 'inherited minimum button track exceeds the actual terminal rail');
});

test('terminal owns one vertical nav track at desktop and intermediate widths in both saved collapse states', () => {
  for (const width of [721, 760, 831, 1100, 1101, 1366, 1920]) for (const collapsed of [false, true]) {
    const chain = [layout(collapsed), nav];
    assert.equal(computed(styles, width, chain, 'display'), 'grid', `${width}/${collapsed} nav layout`);
    assert.equal(computed(styles, width, chain, 'grid-template-columns'), 'minmax(0,1fr)', `${width}/${collapsed} nav tracks`);
    assert.equal(computed(styles, width, [layout(collapsed)], 'grid-template-columns'), '64pxminmax(0,1fr)', `${width}/${collapsed} terminal columns`);
  }
});

test('mobile terminal is a full-width row with horizontally scrollable navigation even when saved as collapsed', () => {
  for (const width of [390, 720]) for (const collapsed of [false, true]) {
    assert.equal(computed(styles, width, [layout(collapsed)], 'grid-template-columns'), 'minmax(0,1fr)', `${width}/${collapsed}`);
    assert.equal(computed(styles, width, [layout(collapsed), nav], 'display'), 'flex');
    assert.equal(computed(styles, width, [layout(collapsed), nav], 'width'), '100%');
    assert.equal(computed(styles, width, [layout(collapsed), nav], 'overflow-x'), 'auto');
  }
});
