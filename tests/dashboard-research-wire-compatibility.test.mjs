import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readLatestResearchQuote,buildResearchEvidence} from '../src/dashboard-research-evidence.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {parseVerifiedResearchLiveEventWire} from '../src/research-live-event-wire.mjs';

// All bytes are freshly produced synthetic fixtures. No bridge/SDK import,
// account, network, original ledger, or current-machine market data is used.
const repo=fileURLToPath(new URL('../',import.meta.url));
const now=new Date('2026-11-02T02:00:01.000Z');
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const digest=raw=>crypto.createHash('sha256').update(raw).digest('hex');
let root,manifest;
before(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'research-python-wire-'));
  const producer=spawnSync('python3',['-B',fileURLToPath(new URL('./fixtures/research-python-ledger-wire.py',import.meta.url)),repo,root],{
    encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000,
  });
  assert.equal(producer.status,0,producer.stderr);
  manifest=JSON.parse(producer.stdout);
  assert.equal(manifest.syntheticOnly,true);
  assert.equal(manifest.bridgeModuleImported,false);
  assert.equal(manifest.sdkImported,false);
});
after(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});

const controls=['integer_control','decimal_prices','float_prices','decimal_volumes','decimal_auxiliary','fractional_auxiliary_control'];
for(const name of controls){
  test(`fresh Python wire compatibility: ${name}`,()=>{
    const entry=manifest.cases[name],raw=fs.readFileSync(entry.file);
    assert.equal(entry.pythonRawHashVerified,true);
    assert.equal(digest(raw),entry.wireSha256);
    const original=JSON.parse(raw);
    assert.equal(buildResearchEvidence({quote:original,calendar,now}).depth.state,'READY','original quote satisfies current L5 quality gate');
    try{
      const quote=readLatestResearchQuote(path.join(root,name),now);
      assert.equal(quote?.recordHash,entry.recordHash,'reader admits original Python record without rehashing it');
      assert.deepEqual(quote,original);
      assert.equal(buildResearchEvidence({quote,calendar,now}).depth.state,'READY');
    }finally{
      assert.deepEqual(fs.readFileSync(entry.file),raw,'read must preserve original append-only wire bytes');
    }
  });
}

test('fresh Python nested exponent, negative-zero and Unicode wire keeps original hash',()=>{
  const entry=manifest.cases.nested_python_lexemes,raw=fs.readFileSync(entry.file);
  assert.match(raw.toString('utf8'),/1e-07/);
  assert.match(raw.toString('utf8'),/-0\.0/);
  const quote=readLatestResearchQuote(path.join(root,'nested_python_lexemes'),now);
  assert.equal(quote?.recordHash,entry.recordHash);
  assert.equal(buildResearchEvidence({quote,calendar,now}).depth.state,'READY');
  assert.deepEqual(fs.readFileSync(entry.file),raw);
});

test('actual JS builder nested integer-index and Unicode keys keep original hash',()=>{
  const original=JSON.parse(fs.readFileSync(manifest.cases.integer_control.file));
  const {recordHash,...body}=original;
  body.payload.synthetic_auxiliary={
    '10':'ten','2':'two','😀':'astral','\uE000':'private-use',
    nested:[{'10':10,'2':2,'😀':0.25,'\uE000':1}],
  };
  const record=buildLiveEventRecord(body,body.previousHash),raw=JSON.stringify(record)+'\n';
  const directory=path.join(root,'js-key-order-control');
  fs.mkdirSync(path.join(directory,'live-events'),{recursive:true});
  const file=path.join(directory,'live-events','2026-11-02.ndjson');
  fs.writeFileSync(file,raw);
  const quote=readLatestResearchQuote(directory,now);
  assert.equal(quote?.recordHash,record.recordHash);
  assert.deepEqual(quote,record);
  assert.equal(buildResearchEvidence({quote,calendar,now}).depth.state,'READY');
  assert.equal(fs.readFileSync(file,'utf8'),raw);
});

function transformedFixture(name,transform,sourceCase='decimal_prices'){
  const sourceFile=manifest.cases[sourceCase].file;
  const original=fs.readFileSync(sourceFile,'utf8');
  const dir=path.join(root,'negative-'+name);
  fs.mkdirSync(path.join(dir,'live-events'),{recursive:true});
  const raw=transform(original);
  assert.notEqual(raw,original,'negative fixture must change original wire');
  fs.writeFileSync(path.join(dir,'live-events','2026-11-02.ndjson'),raw);
  assert.equal(readLatestResearchQuote(dir,now),null);
  assert.equal(fs.readFileSync(sourceFile,'utf8'),original);
}

test('Python wire hash still rejects changed price, volume and numeric lexeme',()=>{
  transformedFixture('price',raw=>raw.replace('10000.0','10001.0'));
  transformedFixture('volume',raw=>raw.replace('"bid_volume":[10,20','"bid_volume":[11,20'));
  transformedFixture('lexeme',raw=>raw.replace('10000.0','1e4'));
});

test('duplicate root or nested keys cannot authenticate by JSON.parse last-value semantics',()=>{
  // Use the admitted integer control so an unrelated float mismatch cannot
  // hide acceptance through last-value-wins parsing.
  transformedFixture('duplicate-root',raw=>raw.replace('"kind":"futures_bidask"','"kind":"futures_bidask","kind":"futures_bidask"'),'integer_control');
  transformedFixture('duplicate-nested',raw=>raw.replace('"simtrade":false','"simtrade":false,"simtrade":false'),'integer_control');
  transformedFixture('duplicate-escaped',raw=>raw.replace('"simtrade":false','"simtrade":false,"\\u0073imtrade":false'),'integer_control');
});

test('malformed or incomplete Python wire remains unavailable',()=>{
  transformedFixture('trailing-garbage',raw=>raw.trimEnd()+' garbage\n');
  transformedFixture('truncated',raw=>raw.slice(0,-8));
  transformedFixture('no-complete-line',raw=>raw.trimEnd());
});

for(const name of ['unsafe_execution','unsafe_order_routes','sensitive_payload','missing_code','invalid_receipt']){
  test(`hash-valid Python-format hostile record remains rejected: ${name}`,()=>{
    const entry=manifest.cases[name],raw=fs.readFileSync(entry.file);
    assert.equal(entry.pythonRawHashVerified,true);
    assert.equal(entry.hostileSyntheticControl,true);
    assert.equal(readLatestResearchQuote(path.join(root,name),now),null);
    assert.equal(digest(fs.readFileSync(entry.file)),entry.wireSha256);
    assert.deepEqual(fs.readFileSync(entry.file),raw);
  });
}

test('UTF-8 corruption and a leading BOM cannot change the authenticated original wire',()=>{
  const entry=manifest.cases.integer_control,raw=fs.readFileSync(entry.file);
  const dir=path.join(root,'invalid-utf8');fs.mkdirSync(path.join(dir,'live-events'),{recursive:true});
  const file=path.join(dir,'live-events','2026-11-02.ndjson');
  // A replacement-decoding reader could otherwise turn this into a valid hash
  // for U+FFFD; strict decoding must reject the original invalid UTF-8 bytes.
  const {recordHash,...body}=JSON.parse(raw);
  body.payload.synthetic_auxiliary='\uFFFD';
  const normalized=JSON.stringify(buildLiveEventRecord(body,body.previousHash))+'\n';
  const buffer=Buffer.from(normalized),marker=buffer.indexOf(Buffer.from('\uFFFD'));
  assert.notEqual(marker,-1);
  fs.writeFileSync(file,Buffer.concat([buffer.subarray(0,marker),Buffer.from([0xff]),buffer.subarray(marker+3)]));
  assert.equal(readLatestResearchQuote(dir,now),null);
  fs.writeFileSync(file,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),raw]));
  assert.equal(readLatestResearchQuote(dir,now),null);
});

test('bounded tail trims partial byte lines before decoding a valid newest complete quote',()=>{
  const raw=fs.readFileSync(manifest.cases.decimal_prices.file);
  const dir=path.join(root,'partial-utf8-boundaries');fs.mkdirSync(path.join(dir,'live-events'),{recursive:true});
  fs.writeFileSync(path.join(dir,'live-events','2026-11-02.ndjson'),Buffer.concat([
    Buffer.from('😀'.repeat(300_000)+'\n'),raw,Buffer.from('{"unfinished":"'),Buffer.from('😀').subarray(0,2),
  ]));
  const quote=readLatestResearchQuote(dir,now);
  assert.equal(quote?.recordHash,manifest.cases.decimal_prices.recordHash);
});

test('hash-valid oversized, overdeep and excessive-node records fail closed',()=>{
  const {recordHash,...body}=JSON.parse(fs.readFileSync(manifest.cases.integer_control.file));
  const nested=depth=>{let value='leaf';for(let i=0;i<depth;i++)value=[value];return value;};
  const wire=value=>JSON.stringify(buildLiveEventRecord({...body,payload:{...body.payload,synthetic_auxiliary:value}},body.previousHash));
  assert.equal(parseVerifiedResearchLiveEventWire(wire(nested(60))).payload.synthetic_auxiliary.length,1);
  for(const value of [nested(65),'x'.repeat(1024*1024),Array(100_001).fill(0)]){
    assert.throws(()=>parseVerifiedResearchLiveEventWire(wire(value)),/research_live_event_wire_invalid/);
  }
});

test('existing JS escaped lone-surrogate records retain original builder compatibility',()=>{
  const {recordHash,...body}=JSON.parse(fs.readFileSync(manifest.cases.integer_control.file));
  body.payload.synthetic_auxiliary='\ud800';
  const record=buildLiveEventRecord(body,body.previousHash);
  assert.deepEqual(parseVerifiedResearchLiveEventWire(JSON.stringify(record)),record);
});

test('previousHash tampering or unsupported hash identity cannot pass wire verification',()=>{
  const raw=fs.readFileSync(manifest.cases.integer_control.file,'utf8');
  assert.throws(()=>parseVerifiedResearchLiveEventWire(raw.replace('"previousHash":"GENESIS"','"previousHash":"'+'a'.repeat(64)+'"')));
  const record=JSON.parse(raw);record.previousHash='unsupported';
  // Actual JS codec can hash arbitrary prior strings, but research wire only
  // accepts the documented GENESIS/hash chain identity.
  const {recordHash,...body}=record;
  assert.throws(()=>parseVerifiedResearchLiveEventWire(JSON.stringify(buildLiveEventRecord(body,body.previousHash))));
});

for(const name of ['precision_price','precision_volume','underflow_auxiliary','unsafe_integer_auxiliary','exact_unsafe_integer_auxiliary','overflow_auxiliary']){
  test(`hash-valid raw number loses precision or range and remains rejected: ${name}`,()=>{
    const entry=manifest.cases[name],raw=fs.readFileSync(entry.file);
    assert.equal(entry.wireLexemeHashVerified,true);
    assert.equal(entry.hostileSyntheticControl,true);
    const parsed=JSON.parse(raw);
    if(name==='precision_price')assert.equal(parsed.payload.bid_price[0],10000);
    if(name==='precision_volume')assert.equal(parsed.payload.bid_volume[0],10);
    if(name==='underflow_auxiliary')assert.equal(parsed.payload.SYNTHETIC_NONZERO_UNDERFLOW,0);
    if(name.includes('unsafe_integer_auxiliary'))assert.equal(Number.isSafeInteger(parsed.payload.SYNTHETIC_UNSAFE_INTEGER),false);
    if(name==='overflow_auxiliary')assert.equal(parsed.payload.SYNTHETIC_OVERFLOW,Infinity);
    assert.equal(readLatestResearchQuote(path.join(root,name),now),null);
    assert.equal(digest(fs.readFileSync(entry.file)),entry.wireSha256);
    assert.deepEqual(fs.readFileSync(entry.file),raw);
  });
}
