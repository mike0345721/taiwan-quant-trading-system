import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ROADMAP.md was replaced by the Owner-approved v2 roadmap (CLAUDE.md supersedes the
// old governance documents), so only the legacy AGENTS.md wording is still checked here.
// AGENTS.md is archived in WP 0-5.
test('AGENTS keeps the governed authority model without self-authorizing work', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

  assert.match(agents, /Product Owner/);
  assert.match(agents, /Linear.*CURRENT.*NEXT/);
});
