import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Bounded read-only sampling. This estimates capacity, never capture completeness
// or strategy performance. It does not repair/rewrite source records.
const file=path.resolve(process.argv[2]??'');
if(!/^2026-11-\d{2}\.ndjson$/.test(path.basename(file)))throw Error('NOVEMBER_SOURCE_REQUIRED');
const fd=fs.openSync(file,'r'),stat=fs.fstatSync(fd),budget=8*1024*1024;
const samples=[];
try{
  for(const target of [0,Math.floor(stat.size/2),Math.max(0,stat.size-budget)]){
    const bytes=Buffer.alloc(Math.min(budget,stat.size-target));fs.readSync(fd,bytes,0,bytes.length,target);
    let cursor=target===0?0:bytes.indexOf(10)+1;const counts={},seconds=new Map();let first=null,last=null,records=0,txBytes=0;
    for(;;){const end=bytes.indexOf(10,cursor);if(end<0)break;const raw=bytes.subarray(cursor,end);cursor=end+1;
      let record;try{record=JSON.parse(raw);}catch{continue;}records++;
      const at=Date.parse(record.receivedAt);if(!Number.isFinite(at))continue;first=first===null?at:Math.min(first,at);last=last===null?at:Math.max(last,at);
      const p=record.payload??{},family=p.productFamily??p._product_family;
      const isTx=family==='TX'||(!family&&/^TXF/.test(p.actualContract??p.targetCode??p.code??record.code??''));
      if(!isTx||!['futures_tick','futures_bidask'].includes(record.kind))continue;
      counts[record.kind]=(counts[record.kind]??0)+1;txBytes+=raw.length+1;
      const second=Math.floor(at/1000);seconds.set(second,(seconds.get(second)??0)+1);
    }
    const durationSeconds=first===null||last===null?null:(last-first)/1000;
    const rate=durationSeconds>0?Object.values(counts).reduce((a,b)=>a+b,0)/durationSeconds:null;
    samples.push({offset:target,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),records,
      firstReceivedAt:first===null?null:new Date(first).toISOString(),lastReceivedAt:last===null?null:new Date(last).toISOString(),durationSeconds,txCounts:counts,
      txEventsPerSecond:rate,txRawBytes:txBytes,maxObservedSecondEvents:Math.max(0,...seconds.values()),
      estimated14HourEventsAtSampleMean:rate===null?null:Math.ceil(rate*14*3600),
      estimated4HourEventsAtSampleMean:rate===null?null:Math.ceil(rate*4*3600)});
  }
}finally{fs.closeSync(fd);}
console.log(JSON.stringify({schemaVersion:'cru61-capacity-rate-audit-v1',observedAt:new Date().toISOString(),source:file,
  fixedEndOffset:stat.size,sourceMtime:stat.mtime.toISOString(),readBudgetBytes:budget*3,samples,
  legalLongestSessionHours:14,ruleSource:'https://www.taifex.com.tw/cht/2/tX',
  caveats:['SAMPLED_RATE_NOT_WHOLE_SESSION_MAXIMUM','SOURCE_MAY_GROW_AFTER_FIXED_END','NO_NATIVE_SEQUENCE_COMPLETENESS_INFERENCE',
    'SYNTHETIC_FULL_DURATION_LOAD_REQUIRED_SEPARATELY'],researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false},null,2));
