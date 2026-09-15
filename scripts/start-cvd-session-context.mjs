import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadSessionContext } from '../src/cvd-session-context-artifact.mjs';
import { assertIsolatedWorktree, assertPlainPath, PRIVATE_ROOT, REPO } from '../src/cvd-observation-isolation.mjs';
import { createCvdCandidateServer } from '../src/cvd-candidate-server.mjs';
try {
  const { head } = assertIsolatedWorktree(), bundleHash = process.argv[2];
  if (execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim()) throw Error('CANDIDATE_CLEAN_EXACT_HEAD_REQUIRED');
  const { charts: frames, relationships, handoffs, sessionContext } = loadSessionContext(bundleHash), assets = {};
  for (const [route, file, type] of [['/', 'cru54-relationship.html', 'text/html'], ['/candidate.js', 'cru54-relationship.js', 'text/javascript'], ['/candidate.css', 'cru54-relationship.css', 'text/css']]) {
    assets[route] = { body: fs.readFileSync(assertPlainPath(path.join(REPO, 'public', file))), type: `${type}; charset=utf-8` };
  }
  const vendor = path.join(path.dirname(fileURLToPath(import.meta.resolve('lightweight-charts'))), 'lightweight-charts.standalone.production.js');
  if (!vendor.startsWith(path.join(REPO, 'node_modules') + path.sep)) throw Error('CANDIDATE_LOCAL_DEPENDENCY_REQUIRED');
  assets['/vendor.js'] = { body: fs.readFileSync(assertPlainPath(vendor)), type: 'text/javascript; charset=utf-8' };
  const { server, token } = createCvdCandidateServer({ frames, relationships, handoffs, sessionContext, assets, head });
  server.once('error', error => { console.error(error.code || error.message); process.exitCode = 1; });
  server.listen({ port: 3054, host: '127.0.0.1', exclusive: true }, () => {
    const root = assertPlainPath(path.join(PRIVATE_ROOT, 'candidate-runtime')); fs.mkdirSync(root, { recursive: true }); assertPlainPath(root);
    const receipt = { head, bundleHash, pid: process.pid, startedAt: new Date().toISOString(), url: 'http://127.0.0.1:3054/', bootstrapUrl: `http://127.0.0.1:3054/#${token}` };
    fs.writeFileSync(assertPlainPath(path.join(root, `session-${process.pid}.json`)), JSON.stringify(receipt), { flag: 'wx' });
    console.log(JSON.stringify({ head, bundleHash, pid: process.pid, url: receipt.url, state: 'ISOLATED_SESSION_CONTEXT' }));
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
