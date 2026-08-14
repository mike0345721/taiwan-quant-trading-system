import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('AGENTS and Roadmap share the governed authority model without self-authorizing work', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const roadmap = fs.readFileSync(path.join(root, 'ROADMAP.md'), 'utf8');

  assert.match(agents, /Product Owner/);
  assert.match(agents, /Linear.*CURRENT.*NEXT/);
  assert.match(roadmap, /Product Owner/);
  assert.match(roadmap, /Linear.*live CURRENT.*NEXT/);
  assert.match(roadmap, /GitHub `main`/);
  assert.match(roadmap, /`CURRENT`/);
  assert.match(roadmap, /CURRENT.*NEXT.*FUTURE/);
});
