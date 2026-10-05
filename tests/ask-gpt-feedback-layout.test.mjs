import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/trader-terminal-shell.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('desktop Ask GPT row grows with real status and recovery content rather than a fixed height', () => {
  const rule = css.match(/\.tt-tier-three-grid\s*\{\s*grid-template-columns:\s*1\.75fr[^}]+\}/)?.[0];
  assert.ok(rule, 'desktop three-card row rule must remain explicit');
  assert.match(rule, /(?:^|[;{])\s*height:\s*auto\s*;/);
  assert.match(rule, /min-height:\s*clamp\(205px,\s*20vh,\s*220px\)/);
  assert.doesNotMatch(rule, /(?:^|[;{])\s*(?:max-)?height:\s*(?:clamp|\d)/);
});

test('status and recovery remain normal card content, not an overlay or removed fallback', () => {
  const body = html.slice(html.indexOf('class="dw-gpt-body"'), html.indexOf('<details class="dw-gpt-more">'));
  assert.match(body, /id="dw-gpt-feedback"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(body, /id="dw-open-chatgpt"[^>]*href="https:\/\/chatgpt\.com\/"/);
  assert.ok(body.indexOf('dw-copy-gpt-prompt') < body.indexOf('dw-gpt-feedback'));
  assert.ok(body.indexOf('dw-gpt-feedback') < body.indexOf('dw-open-chatgpt'));
});

// These source contracts prevent restoring the known fixed-height root cause.
// Real-browser ancestor-clipping checks at wide and narrow widths are still
// required for release; source tests alone do not certify visible usability.
