import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// WP 0-5: CLAUDE.md is the only governance file; the legacy AGENTS.md is archived, not active.
test('CLAUDE.md is the governing rule file and the legacy AGENTS.md is only archived', () => {
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /取代舊的 AGENTS\.md/);
  assert.match(claude, /做之前要先問 Owner 的動作/);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false, 'legacy governance must not sit at the root');
  assert.ok(fs.existsSync(path.join(root, 'docs/archive/root/AGENTS.md')), 'legacy governance stays recoverable');
});
