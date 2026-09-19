import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { FRAMES } from './cvd-chart-projection.mjs';
import { loadCvdRelationship } from './cvd-relationship-artifact.mjs';
import { assertPlainPath, assertIsolatedWorktree, PRIVATE_ROOT, REPO } from './cvd-observation-isolation.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { buildCvdHandoffProjection } from './cvd-handoff-projection.mjs';

const validHash = hash => /^[a-f0-9]{64}$/.test(hash || '');
const codeIdentity = () => digest(stableJson(['src/cvd-handoff-projection.mjs','src/cvd-handoff-artifact.mjs',
  'src/dashboard-tx-chart.mjs','src/market-state-forward-shadow-calendar.mjs','config/taifex-official-calendar-2026.json']
  .map(f => digest(fs.readFileSync(path.join(REPO,f))))));
const loadedCode = codeIdentity();
function readBundle(folder, hash, maxBytes) {
  assertIsolatedWorktree();
  if (!validHash(hash)) throw Error('HANDOFF_BUNDLE_ID_INVALID');
  const file = assertPlainPath(path.join(PRIVATE_ROOT,folder,hash+'.json')), fd = fs.openSync(file,'r');
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > maxBytes) throw Error('HANDOFF_BUNDLE_FILE_INVALID');
    const bytes = Buffer.alloc(st.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd,bytes,offset,bytes.length-offset,offset); if (!n) throw Error('HANDOFF_BUNDLE_TRUNCATED'); offset += n; }
    const after = fs.fstatSync(fd);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) throw Error('HANDOFF_BUNDLE_CHANGED');
    const bundle = JSON.parse(bytes), { bundleHash, ...body } = bundle;
    if (bundleHash !== hash || digest(stableJson(body)) !== hash) throw Error('HANDOFF_BUNDLE_HASH_INVALID');
    return bundle;
  } finally { fs.closeSync(fd); }
}
function derive(priorHash, currentHash) {
  if (codeIdentity() !== loadedCode) throw Error('HANDOFF_LOADED_CODE_CHANGED');
  const current = loadCvdRelationship(currentHash), prior = priorHash == null ? null : loadCvdRelationship(priorHash);
  // C is independently verified by its unchanged loader; this sealed copy exposes
  // only its canonical context to offline D derivation. No raw paths are opened.
  const currentBody = readBundle('relationship',currentHash,32*1024*1024);
  const priorBody = prior ? readBundle('relationship',priorHash,32*1024*1024) : null;
  const calendar = loadGovernedTradingCalendar(path.join(REPO,'config/taifex-official-calendar-2026.json'));
  const handoffs = Object.fromEntries(FRAMES.map(f => [f,buildCvdHandoffProjection(prior,current,priorBody?.events ?? [],currentBody.events,calendar,f)]));
  return { current, handoffs };
}
export function prepareCvdHandoff(priorHash, currentHash) {
  const { handoffs } = derive(priorHash,currentHash);
  const body = { schemaVersion:'cru54-handoff-bundle-v1', ...SAFETY, priorHash, currentHash, codeIdentity:loadedCode, handoffs };
  const bundleHash = digest(stableJson(body)), bytes = stableJson({ ...body,bundleHash })+'\n';
  if (Buffer.byteLength(bytes) > 1024*1024) throw Error('HANDOFF_BUNDLE_BUDGET');
  const dir = assertPlainPath(path.join(PRIVATE_ROOT,'handoff')); fs.mkdirSync(dir,{recursive:true}); assertPlainPath(dir);
  const target = assertPlainPath(path.join(dir,bundleHash+'.json')), temp = assertPlainPath(path.join(dir,crypto.randomUUID()+'.tmp')); let fd;
  try {
    fd = fs.openSync(temp,'wx'); fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    try { fs.linkSync(temp,target); } catch(e) { if(e.code !== 'EEXIST' || stableJson(readBundle('handoff',bundleHash,1024*1024))+'\n' !== bytes) throw e; }
  } finally { try { if(fd != null) fs.closeSync(fd); } catch {} try { fs.unlinkSync(temp); } catch {} }
  return { bundleHash, priorHash, currentHash, bytes:Buffer.byteLength(bytes), state:handoffs['1m'].handoff };
}
export function loadCvdHandoff(bundleHash) {
  const bundle = readBundle('handoff',bundleHash,1024*1024);
  if (bundle.schemaVersion !== 'cru54-handoff-bundle-v1' || bundle.codeIdentity !== loadedCode
    || Object.entries(SAFETY).some(([k,v])=>bundle[k] !== v)) throw Error('HANDOFF_BUNDLE_INVALID');
  const { current, handoffs } = derive(bundle.priorHash,bundle.currentHash);
  if (stableJson(handoffs) !== stableJson(bundle.handoffs)) throw Error('HANDOFF_PROJECTION_MISMATCH');
  return { ...current, handoffs };
}
