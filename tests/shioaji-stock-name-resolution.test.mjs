import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Include the stdlib-only Python regression in the existing hermetic CI lane.
// No SDK import, credential read, login, server, collector or network is started.
test('Shioaji stock-name cold-cache and fail-closed regression', { timeout: 30_000 }, (t) => {
  const script = fileURLToPath(new URL('./test_shioaji_stock_name_resolution.py', import.meta.url));
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [script], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.ifError(result.error);
  assert.equal(result.signal, null, output);
  assert.equal(result.status, 0, output);
  assert.match(output, /Ran 13 tests/);
  assert.match(output, /\nOK\s*$/);
  t.diagnostic(output.trim());
});
