import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { FRAMES } from './cvd-chart-projection.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PRIVATE = path.join(ROOT, 'data/cru55-private');
export const BRANCH = 'codex/cru-55-premerge-ui-v1';
export const ACCEPTED = '66de7e9a416e9f2386eed1c9e8688afea1b804ab';
export const MAIN = 'd3702315b46a1a6c23384338ae40904b8bc589c2';
export const git = (args, cwd = ROOT) => execFileSync('git', args, {cwd, encoding:'utf8', windowsHide:true, timeout:15000}).trim();
export function isolated({clean = false} = {}) {
  assertPlainPath(ROOT); assertPlainPath(PRIVATE);
  if (!fs.lstatSync(path.join(ROOT,'.git')).isFile() || git(['branch','--show-current']) !== BRANCH) throw Error('CRU55_ISOLATED_WORKTREE_REQUIRED');
  if (clean && git(['status','--porcelain'])) throw Error('CRU55_CLEAN_EXACT_HEAD_REQUIRED');
  if (!git(['check-ignore',path.join(PRIVATE,'probe.json')])) throw Error('CRU55_PRIVATE_OUTPUT_NOT_IGNORED');
  return git(['rev-parse','HEAD']);
}
export function validateView(v) {
  const p = v?.charts?.['1m'];
  if (!p || !v.sessionContext || !v.relationships || !v.handoffs) throw Error('CRU55_REQUIRED_SLICE_MISSING');
  const safe = value => { if (Object.entries(SAFETY).some(([k,x])=>value[k] !== x)) throw Error('CRU55_SAFETY_MISMATCH'); };
  safe(v.sessionContext);
  if(!['GOVERNED_FRAGMENT','SYNTHETIC_FIXTURE'].includes(v.kind) || v.sessionContext.evidenceKind!==v.kind) throw Error('CRU55_SOURCE_KIND_MISMATCH');
  for (const f of FRAMES) {
    const c=v.charts[f], r=v.relationships[f], h=v.handoffs[f], s=v.sessionContext;
    if (!c || !r || !h) throw Error('CRU55_FRAME_MISSING');
    for (const x of [c,r,h]) safe(x);
    if (c.timeframe!==f || r.timeframe!==f || h.timeframe!==f || c.currentCvd!==p.currentCvd) throw Error('CRU55_TIMEFRAME_ENDPOINT_MISMATCH');
    for (const x of [r,h,s]) if (x.generationHash!==c.generationHash || x.semanticHash!==c.semanticHash || x.sourceCutoff?.recordHash!==c.cutoff.recordHash) throw Error('CRU55_BINDING_MISMATCH');
    if (c.generationHash!==p.generationHash || c.cutoff.recordHash!==p.cutoff.recordHash) throw Error('CRU55_CUTOFF_MISMATCH');
    if(r.evidenceKind!==v.kind || (h.evidenceKind && h.evidenceKind!==v.kind)) throw Error('CRU55_SOURCE_KIND_MISMATCH');
  }
  return v;
}
export function boundedRead(file,cap) {
  assertPlainPath(file);
  const fd=fs.openSync(file,'r');
  try {
    const st=fs.fstatSync(fd);
    if(!st.isFile() || st.nlink!==1 || st.size>cap)throw Error('CRU55_BUNDLE_BUDGET');
    const bytes=Buffer.alloc(st.size);let offset=0;
    while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)throw Error('CRU55_FILE_TRUNCATED');offset+=n;}
    const after=fs.fstatSync(fd);
    if(after.size!==st.size || after.mtimeMs!==st.mtimeMs)throw Error('CRU55_FILE_CHANGED');
    return bytes;
  }finally{fs.closeSync(fd);}
}
export function loadPreview(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw Error('CRU55_BUNDLE_ID_INVALID');
  const file=assertPlainPath(path.join(PRIVATE,'bundles',hash+'.json'));
  const {bundleHash,...body}=JSON.parse(boundedRead(file,48*1024*1024));
  if (bundleHash!==hash || digest(stableJson(body))!==hash || body.acceptedHead!==ACCEPTED || body.approvedMain!==MAIN) throw Error('CRU55_BUNDLE_INVALID');
  for(const view of Object.values(body.views)) validateView(view);
  if (body.views.day.kind!=='GOVERNED_FRAGMENT' || body.views.night.kind!=='GOVERNED_FRAGMENT' || body.views.demo.kind!=='SYNTHETIC_FIXTURE') throw Error('CRU55_SOURCE_KIND_INVALID');
  return body;
}
