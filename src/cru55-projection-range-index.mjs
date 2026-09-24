import { digest, stableJson } from './cvd-observation-core.mjs';
import { projectionPrimitives } from './cru55-stream-projection.mjs';

// Immutable ordinal forest. One durable object per archive page contains all
// new leaves/internal nodes; older roots are addressed by hash, never rewritten.
// Aggregates are used only for exact safe-integer folds. Fractional/unsafe sums
// descend to leaves and preserve the oracle's physical-order IEEE754 additions.
const { accumulator, accumulate } = projectionPrimitives;
const sums = ['n','buy','sell','unknown','total','qbuy','qsell','inside','unavailable','matched','conflicts','delta','classified'];
const flags = ['nullGap','badIdentity','badAvailability','badPrice','badVolume'];
const schema = 'cru55-projection-range-page-v1';
const validHash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const fail = code => { throw Error(code); };

export function mergeRangeAccumulators(left, right) {
  if (!left.n) return structuredClone(right);
  if (!right.n) return structuredClone(left);
  const out = { ...left, last: right.last };
  for (const key of sums) out[key] = left[key] + right[key];
  for (const key of flags) out[key] = left[key] || right[key];
  if (!left.pathReason) {
    const gap = right.first.eventMs - left.last.eventMs;
    if (gap < 0) out.pathReason = 'QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION';
    else {
      out.maxGap = Math.max(left.maxGap, gap);
      if (gap > 30000) out.pathReason = 'QUALITY_INSUFFICIENT_LONG_GAP';
      else {
        out.path = (left.path + Math.abs(right.first.price - left.last.price)) + right.path;
        out.maxGap = Math.max(out.maxGap, right.maxGap);
        out.pathReason = right.pathReason;
      }
    }
  }
  return out;
}
export function mergeRangeDisplay(left, right) {
  if (!left) return right;
  if (!right) return left;
  return { first:left.first, last:right.last,
    min:left.min.value === null ? (right.min.value === null ? left.min : right.min) : right.min.value !== null && right.min.value < left.min.value ? right.min : left.min,
    max:left.max.value === null ? (right.max.value === null ? left.max : right.max) : right.max.value !== null && right.max.value > left.max.value ? right.max : left.max,
    gap:left.gap ?? right.gap };
}
function leafSummary(e,p,prior,pressure) {
  const acc=accumulator(); accumulate(acc,e,p,prior,pressure);
  const absolute=Object.fromEntries(sums.map(key=>[key,Math.abs(acc[key])]));
  const d={time:e.availableMs/1000,value:p.value,ledgerOrdinal:p.ledgerOrdinal,recordHash:p.recordHash,availableAt:p.availableAt,eventTime:p.eventTime,reason:p.reason};
  const safe=sums.every(key=>Number.isSafeInteger(acc[key])) && Number.isSafeInteger(Number(acc.first.price));
  return {count:1,lo:p.ledgerOrdinal,hi:p.ledgerOrdinal,eventMin:e.eventMs,eventMax:e.eventMs,availableMin:e.availableMs,availableMax:e.availableMs,
    finiteTime:Number.isFinite(e.eventMs)&&Number.isFinite(e.availableMs),acc,absolute,pathBound:0,safe,display:{first:d,last:d,min:d,max:d,gap:p.value===null?d:null}};
}
function combine(a,b) {
  const absolute=Object.fromEntries(sums.map(key=>[key,a.absolute[key]+b.absolute[key]]));
  const pathBound=a.pathBound+Math.abs(b.acc.first.price-a.acc.last.price)+b.pathBound;
  return {count:a.count+b.count,lo:a.lo,hi:b.hi,eventMin:Math.min(a.eventMin,b.eventMin),eventMax:Math.max(a.eventMax,b.eventMax),
    availableMin:Math.min(a.availableMin,b.availableMin),availableMax:Math.max(a.availableMax,b.availableMax),finiteTime:a.finiteTime&&b.finiteTime,
    acc:mergeRangeAccumulators(a.acc,b.acc),absolute,pathBound,
    safe:a.safe&&b.safe&&Object.values(absolute).every(Number.isSafeInteger)&&Number.isSafeInteger(pathBound),display:mergeRangeDisplay(a.display,b.display)};
}
const external = (ref,hash) => typeof ref === 'number' ? {hash,index:ref} : ref;

export function beginRangeAppend(roots,writePage) {
  const nodes=[],forest=structuredClone(roots??[]);
  const addNode=node=>{nodes.push(node);return {ref:nodes.length-1,summary:node.summary};};
  return {
    append(e,p,prior,pressure) {
      let current=addNode({summary:leafSummary(e,p,prior,pressure)});
      while(forest.length && forest.at(-1).summary.count===current.summary.count) {
        const left=forest.pop();
        if(left.summary.hi>=current.summary.lo)fail('STREAM_RANGE_APPEND_ORDER');
        current=addNode({left:left.ref,right:current.ref,summary:combine(left.summary,current.summary)});
      }
      forest.push(current);
    },
    finish() {
      if(!nodes.length)return forest;
      const page={schemaVersion:schema,nodes},hash=digest(stableJson(page));
      writePage(hash,page); // fsync/link before the root becomes durable
      return forest.map(root=>({...root,ref:external(root.ref,hash)}));
    }
  };
}

export function createRangeReader(readPage) {
  const cache=new Map();
  return ref=>{
    if(!validHash(ref?.hash)||!Number.isSafeInteger(ref.index)||ref.index<0)fail('STREAM_RANGE_REFERENCE_INVALID');
    let page=cache.get(ref.hash);
    if(!page){
      page=readPage(ref.hash);
      if(page.schemaVersion!==schema||!Array.isArray(page.nodes)||digest(stableJson(page))!==ref.hash)fail('STREAM_RANGE_PAGE_CHANGED');
      cache.set(ref.hash,page);
    }
    const node=page.nodes[ref.index];
    if(!node?.summary||node.summary.lo>node.summary.hi||node.summary.count<1)fail('STREAM_RANGE_NODE_INVALID');
    if((node.left===undefined)!==(node.right===undefined))fail('STREAM_RANGE_NODE_INVALID');
    return {...node,left:node.left===undefined?null:external(node.left,ref.hash),right:node.right===undefined?null:external(node.right,ref.hash)};
  };
}

export function beginRangeQuery(roots,filter,kind='window') {
  return {filter,kind,stack:roots.map(root=>root.ref).reverse(),acc:accumulator(),display:null,visitedNodes:0,aggregateNodes:0,orderedLeaves:0};
}
function canFold(prefix,summary) {
  if(!summary.safe)return false;
  if(!prefix.n)return true;
  if(!sums.every(key=>Number.isSafeInteger(prefix[key])&&Number.isSafeInteger(Math.abs(prefix[key])+summary.absolute[key])))return false;
  const bridge=Math.abs(summary.acc.first.price-prefix.last.price);
  return Number.isSafeInteger(prefix.path)&&Number.isSafeInteger(bridge)&&Number.isSafeInteger(prefix.path+bridge+summary.pathBound);
}
// Mutate only after a node read succeeds. A budget exception leaves the next
// reference intact, so serializing this cursor resumes rather than rescanning.
export function advanceRangeQuery(query,readNode) {
  while(query.stack.length) {
    const node=readNode(query.stack.at(-1)),s=node.summary,f=query.filter;
    query.stack.pop();query.visitedNodes++;
    if(s.hi<f.lo||s.lo>f.hi)continue;
    const ordinalFull=s.lo>=f.lo&&s.hi<=f.hi;
    let full=ordinalFull;
    if(query.kind==='window') {
      if(s.finiteTime && (s.eventMax<=f.lower||s.eventMin>f.upper||s.availableMin>f.available))continue;
      full &&= s.finiteTime&&s.eventMin>f.lower&&s.eventMax<=f.upper&&s.availableMax<=f.available;
    }
    const leaf=node.left===null;
    if(leaf && query.kind==='window' && !(s.eventMin>f.lower&&s.eventMin<=f.upper&&s.availableMin<=f.available))continue;
    if(leaf||(full&&(query.kind==='display'||canFold(query.acc,s)))) {
      if(query.kind==='display')query.display=mergeRangeDisplay(query.display,s.display);
      else query.acc=mergeRangeAccumulators(query.acc,s.acc);
      if(leaf)query.orderedLeaves++;else query.aggregateNodes++;
    } else query.stack.push(node.right,node.left);
  }
  return query;
}

// Walk the forest once for all overlapping windows and disjoint display bins.
// Each accumulator still receives selected subtrees in physical ordinal order.
// A budget interruption keeps the unopened reference and every partial result.
export function beginRangeQueries(roots,specs,historicalOrdinal=0) {
  return {results:specs.map(s=>({filter:s.filter,kind:s.kind==='display'?'display':'window',acc:accumulator(),display:null})),
    stack:roots.map(r=>({ref:r.ref,queries:specs.map((_,i)=>i)})).reverse(),historicalOrdinal,
    visitedNodes:0,aggregateNodes:0,orderedLeaves:0,historicalOrderedLeaves:0,unsafeHistoricalLeaves:0};
}
export function advanceRangeQueries(state,readNode) {
  while(state.stack.length){
    const entry=state.stack.at(-1),node=readNode(entry.ref),s=node.summary;
    state.stack.pop();state.visitedNodes++;
    const descend=[];
    for(const i of entry.queries){
      const q=state.results[i],f=q.filter;
      if(f.lo>f.hi||s.hi<f.lo||s.lo>f.hi)continue;
      let full=s.lo>=f.lo&&s.hi<=f.hi;
      if(q.kind==='window'){
        if(s.finiteTime&&(s.eventMax<=f.lower||s.eventMin>f.upper||s.availableMin>f.available))continue;
        full&&=s.finiteTime&&s.eventMin>f.lower&&s.eventMax<=f.upper&&s.availableMax<=f.available;
      }
      const leaf=node.left===null;
      if(leaf&&q.kind==='window'&&!(s.eventMin>f.lower&&s.eventMin<=f.upper&&s.availableMin<=f.available))continue;
      if(leaf||(full&&(q.kind==='display'||canFold(q.acc,s)))){
        if(q.kind==='display')q.display=mergeRangeDisplay(q.display,s.display);
        else q.acc=mergeRangeAccumulators(q.acc,s.acc);
        if(leaf){state.orderedLeaves++;if(s.hi<=state.historicalOrdinal){state.historicalOrderedLeaves++;if(q.kind==='window'&&!s.safe)state.unsafeHistoricalLeaves++;}}
        else state.aggregateNodes++;
      }else descend.push(i);
    }
    if(descend.length)state.stack.push({ref:node.right,queries:descend},{ref:node.left,queries:descend});
  }
  return state;
}
