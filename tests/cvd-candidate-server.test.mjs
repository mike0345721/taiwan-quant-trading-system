import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createCvdCandidateServer } from '../src/cvd-candidate-server.mjs';
import { FRAMES, buildCvdChartProjection } from '../src/cvd-chart-projection.mjs';
import { SAFETY, stableJson, digest } from '../src/cvd-observation-core.mjs';

test('actual loopback HTTP: session/origin/method/query guards, bounded parity, missing state, zero request filesystem reads', async () => {
  const semantic = { ...SAFETY, segments: [], series: [], value: null, activeIdentity: null, currentReason: 'NO_LAWFUL_TRADE', availableAt: null, lastTradeAvailableAt: null, cutoffRecordHash: 'GENESIS' };
  const g = { generationHash: 'test-generation', result: { semantic, semanticHash: digest(stableJson(semantic)) } };
  const price = { generationHash: g.generationHash, cutoffRecordHash: 'GENESIS', bars: [], timeLineageViolationCount: 0, reason: 'NO_LAWFUL_PRICE_BARS' };
  const frames = Object.fromEntries(FRAMES.map(f => [f, buildCvdChartProjection(g, price, f)]));
  const { server, token } = createCvdCandidateServer({ frames, assets: { '/': { body: '<html>candidate</html>', type: 'text/html' } }, head: 'test-head', port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${root}/api/cvd`)).status, 401);
    assert.equal((await fetch(`${root}/api/cvd`, { headers: { Origin: 'http://untrusted.example' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => { const request = http.get(root, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(`${root}/session`, { method: 'POST', body: token })).status, 403);
    const login = await fetch(`${root}/session`, { method: 'POST', headers: { Origin: root, 'Content-Type': 'text/plain' }, body: token });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const original = fs.readFileSync; fs.readFileSync = () => { throw Error('NO_DISK_IN_REQUEST'); };
    try {
      for (const frame of FRAMES) {
        const response = await fetch(`${root}/api/cvd?timeframe=${frame}`, { headers: { cookie } });
        assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.currentCvd, g.result.semantic.value);
        assert.equal(data.cutoff.recordHash, g.result.semantic.cutoffRecordHash); assert.ok(!('checkpoint' in data));
        assert.equal(data.freshness.state, 'UNAVAILABLE');
      }
    } finally { fs.readFileSync = original; }
    assert.equal((await fetch(`${root}/api/cvd?timeframe=1d`, { headers: { cookie } })).status, 400);
    assert.equal((await fetch(`${root}/api/cvd?path=raw`, { headers: { cookie } })).status, 400);
    assert.equal((await fetch(`${root}/api/cvd`, { method: 'POST', headers: { cookie } })).status, 405);
    assert.equal((await fetch(`${root}/api/cvd`, { headers: { cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    delete frames['1m']; const missing = await fetch(`${root}/api/cvd`, { headers: { cookie } });
    assert.equal(missing.status, 503); assert.equal((await missing.json()).reason, 'CVD_PROJECTION_MISSING');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
