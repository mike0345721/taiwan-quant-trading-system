import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../src/db.mjs';
import { backfillTaifex, downloadPeriod, rebuildOptionOiChanges } from '../src/official-backfill.mjs';

const deltaColumns = ['call_oi_delta_1d','put_oi_delta_1d','call_oi_delta_3d','put_oi_delta_3d','call_oi_delta_5d','put_oi_delta_5d'];
function deltaDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE options_strike_daily(trade_date TEXT,contract TEXT,strike REAL,call_oi INTEGER,put_oi INTEGER,PRIMARY KEY(trade_date,contract,strike));
    CREATE TABLE option_oi_changes(trade_date TEXT,contract TEXT,strike REAL,call_oi INTEGER,put_oi INTEGER,
      ${deltaColumns.map(column => column + ' INTEGER').join(',')},PRIMARY KEY(trade_date,contract,strike));`);
  return db;
}
function oracle(rows) {
  return rows.map(row => {
    const earlier = rows.filter(other => other.contract === row.contract && other.strike === row.strike && other.trade_date < row.trade_date)
      .sort((a,b) => a.trade_date.localeCompare(b.trade_date));
    const value = {...row};
    for (const lag of [1,3,5]) for (const side of ['call','put']) {
      const prior = earlier.at(-lag), field = side + '_oi';
      value[`${field}_delta_${lag}d`] = !prior || row[field] == null || prior[field] == null ? null : row[field] - prior[field];
    }
    return value;
  }).sort((a,b) => a.trade_date.localeCompare(b.trade_date) || a.contract.localeCompare(b.contract) || a.strike - b.strike);
}
test('set-based OI lags match independent contract/strike oracle across gaps, zero, NULL and out-of-order insertion', () => {
  const db = deltaDatabase();
  try {
    const rows = [];
    for (const contract of ['202611','202611W1']) for (const strike of [20000,20100]) {
      for (let i=0;i<9;i++) rows.push({trade_date:`2026-11-${String(i*2+1).padStart(2,'0')}`,contract,strike,
        call_oi:i===3?null:i*3,put_oi:i===5?null:20-i*2});
    }
    const insert = db.prepare('INSERT INTO options_strike_daily VALUES(?,?,?,?,?)');
    for (const row of [...rows].reverse()) insert.run(row.trade_date,row.contract,row.strike,row.call_oi,row.put_oi);
    const before = db.prepare('SELECT * FROM options_strike_daily ORDER BY trade_date,contract,strike').all();
    assert.equal(rebuildOptionOiChanges(db),rows.length);
    const actual = db.prepare('SELECT * FROM option_oi_changes ORDER BY trade_date,contract,strike').all().map(row=>({...row}));
    assert.deepEqual(actual,oracle(rows));
    assert.deepEqual(db.prepare('SELECT * FROM options_strike_daily ORDER BY trade_date,contract,strike').all(),before);
    assert.equal(rebuildOptionOiChanges(db),rows.length);
    assert.deepEqual(db.prepare('SELECT * FROM option_oi_changes ORDER BY trade_date,contract,strike').all().map(row=>({...row})),actual);
  } finally { db.close(); }
});

test('failed OI rebuild rolls back delete and preserves the existing derived result', () => {
  const db = deltaDatabase();
  try {
    db.exec("INSERT INTO options_strike_daily VALUES('2026-11-01','202611',20000,10,20)");
    rebuildOptionOiChanges(db);
    const before = db.prepare('SELECT * FROM option_oi_changes').all();
    db.exec("CREATE TRIGGER reject_derived BEFORE INSERT ON option_oi_changes BEGIN SELECT RAISE(ABORT,'synthetic write rejection'); END;");
    assert.throws(()=>rebuildOptionOiChanges(db),/synthetic write rejection/);
    assert.deepEqual(db.prepare('SELECT * FROM option_oi_changes').all(),before);
  } finally { db.close(); }
});

const big5 = text => Buffer.concat(text.split(/(交易日期|一般|買權|賣權)/).map(part => {
  const hex = {'交易日期':'a5e6a9f6a4e9b4c1','一般':'a440afeb','買權':'b652c576','賣權':'bde6c576'}[part];
  return Buffer.from(hex || part,hex?'hex':'ascii');
}));
function csv(dataset,date='2026-11-04') {
  const day = date.replaceAll('-','/');
  const head = '交易日期,' + Array(18).fill('field').join(',') + '\n';
  return big5(head + (dataset==='futures'
    ? `${day},TX,202611,20000,20100,19900,20050,50,0.25,1000,20050,100,20049,20051,21000,19000,,一般,,\n`
    : `${day},TXO,202611,20000,買權,1,2,1,2,100,2,500,1,2,3,0,,一般,,\n${day},TXO,202611,20000,賣權,1,2,1,2,80,2,400,1,2,3,0,,一般,,\n`));
}
function response(buffer) { return {ok:true,status:200,headers:new Headers({'content-disposition':'attachment; filename=data.csv'}),arrayBuffer:async()=>buffer}; }
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'taifex-backfill-isolated-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir;
}
const range = {start:'2026-11-01',end:'2026-11-04'};
const current = {now:new Date('2026-11-04T08:00:00Z'),timeoutMs:30};
test('one download deadline covers headers and a body that never resolves', async t => {
  const cache = temporary(t); let signal;
  await assert.rejects(downloadPeriod('futures',range,cache,async(_url,options)=> {
    signal=options.signal;return {...response(csv('futures')),arrayBuffer:()=>new Promise(()=>{})};
  },current),/TAIFEX_DOWNLOAD_TIMEOUT/);
  assert.equal(signal.aborted,true);
  assert.deepEqual(fs.readdirSync(cache),[]);
});
test('deadline also bounds a fetch implementation that ignores cancellation', async t => {
  await assert.rejects(downloadPeriod('futures',range,temporary(t),()=>new Promise(()=>{}),current),/TAIFEX_DOWNLOAD_TIMEOUT/);
});
test('network failure uses only validated cache and retains its time, bytes and failure reason', async t => {
  const cache = temporary(t), filename = path.join(cache,'futures-2026-11-01-2026-11-04.csv.gz');
  const original = zlib.gzipSync(csv('futures'));
  fs.writeFileSync(filename,original); fs.utimesSync(filename,new Date('2026-11-03T09:00:00Z'),new Date('2026-11-03T09:00:00Z'));
  const item = await downloadPeriod('futures',range,cache,async()=>{throw Error('synthetic network failure');},current);
  assert.equal(item.sourceState,'CACHE_FALLBACK');assert.equal(item.fallbackReason,'TAIFEX_FETCH_FAILED');
  assert.equal(item.downloadedAt,'2026-11-03T09:00:00.000Z');assert.equal(item.rows.length,1);
  assert.deepEqual(fs.readFileSync(filename),original);
});
test('invalid CSV does not replace a valid cache and never becomes fresh success', async t => {
  const cache = temporary(t), filename=path.join(cache,'futures-2026-11-01-2026-11-04.csv.gz');
  const original=zlib.gzipSync(csv('futures'));fs.writeFileSync(filename,original);
  const item=await downloadPeriod('futures',range,cache,async()=>response(Buffer.alloc(200,65)),current);
  assert.equal(item.fallbackReason,'TAIFEX_INVALID_CSV');assert.equal(item.fallbackFromCache,true);
  assert.deepEqual(fs.readFileSync(filename),original);
});
test('immutable historical cache is reused without claiming a new network acquisition', async t => {
  const cache=temporary(t),filename=path.join(cache,'futures-2026-11-01-2026-11-04.csv.gz');
  fs.writeFileSync(filename,zlib.gzipSync(csv('futures')));
  const item=await downloadPeriod('futures',range,cache,()=>{throw Error('network forbidden');},{now:new Date('2026-11-05T08:00:00Z')});
  assert.equal(item.sourceState,'HISTORICAL_CACHE');assert.equal(item.fallbackFromCache,false);
});
test('partial backfill retains successful source/file receipts and reports current failures separately', async t => {
  const db=new DatabaseSync(':memory:'),cache=temporary(t);
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON');applyMigrations(db,fileURLToPath(new URL('../migrations',import.meta.url)));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const options={startDate:today,endDate:today,cacheDir:cache};
  const good=await backfillTaifex(db,{...options,fetchImpl:async url=>response(csv(url.includes('futData')?'futures':'options',today))});
  assert.equal(good.state,'COMPLETE');
  const sources=db.prepare('SELECT * FROM data_sources ORDER BY source_key').all();
  const receipts=db.prepare('SELECT * FROM official_backfill_files ORDER BY dataset').all();
  const progress=[];
  const partial=await backfillTaifex(db,{...options,fetchImpl:async()=>{throw Error('offline');},onProgress:message=>progress.push(message)});
  assert.equal(partial.state,'PARTIAL_SOURCE_FALLBACK');assert.equal(partial.failures.length,2);
  assert.deepEqual(db.prepare('SELECT * FROM data_sources ORDER BY source_key').all(),sources);
  assert.deepEqual(db.prepare('SELECT * FROM official_backfill_files ORDER BY dataset').all(),receipts);
  assert.equal(partial.optionChangeRows,1);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.ok(progress.some(line=>line.startsWith('Starting post-import reconcile')));
  assert.ok(progress.some(line=>line.startsWith('Completed post-import rebuildOptionOiChanges')));
});

test('failed current fetch never overwrites newer database rows or receipts with an older valid cache', async t => {
  const db=new DatabaseSync(':memory:'),cache=temporary(t);
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON');applyMigrations(db,fileURLToPath(new URL('../migrations',import.meta.url)));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const options={startDate:today,endDate:today,cacheDir:cache};
  const fetchOld=async url=>response(csv(url.includes('futData')?'futures':'options',today));
  await backfillTaifex(db,{...options,fetchImpl:fetchOld});
  const oldCache=fs.readdirSync(cache).map(name=>({name,bytes:fs.readFileSync(path.join(cache,name))}));
  await backfillTaifex(db,{...options,fetchImpl:async url=>{
    const old=csv(url.includes('futData')?'futures':'options',today);
    // Preserve the Big5 bytes while changing only known ASCII numeric fields.
    return response(Buffer.from(old.toString('latin1').replace(',20050,50,',',21500,50,')
      .replace(',500,1,2,',',900,1,2,').replace(',400,1,2,',',800,1,2,'),'latin1'));
  }});
  assert.equal(db.prepare('SELECT tx_close FROM market_daily').get().tx_close,21500);
  assert.equal(db.prepare('SELECT call_oi FROM options_strike_daily').get().call_oi,900);
  const tables=['raw_snapshots','market_daily','futures_contract_daily','options_contract_daily','options_strike_daily','data_sources','official_backfill_files'];
  const before=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  for(const entry of oldCache){
    const filename=path.join(cache,entry.name);fs.writeFileSync(filename,entry.bytes);
    const oldTime=new Date(Date.now()-86400000);fs.utimesSync(filename,oldTime,oldTime);
  }
  const result=await backfillTaifex(db,{...options,fetchImpl:async()=>{throw Error('current fetch failed');}});
  for(const table of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),before[table],table);
  for(const entry of oldCache)assert.deepEqual(fs.readFileSync(path.join(cache,entry.name)),entry.bytes);
  assert.equal(result.state,'PARTIAL_SOURCE_FALLBACK');assert.equal(result.futuresRows,0);assert.equal(result.optionRows,0);
  assert.equal(result.skippedImports.length,2);
  assert.ok(result.sources.every(source=>source.importState==='SKIPPED_SOURCE_FALLBACK'));
  assert.equal(db.prepare('SELECT call_oi FROM option_oi_changes').get().call_oi,900);
});

test('failed current fetch leaves an empty database unknown even when a valid cache exists', async t => {
  const db=new DatabaseSync(':memory:'),cache=temporary(t);
  t.after(()=>db.close());applyMigrations(db,fileURLToPath(new URL('../migrations',import.meta.url)));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const dataset of ['futures','options'])fs.writeFileSync(path.join(cache,`${dataset}-${today}-${today}.csv.gz`),zlib.gzipSync(csv(dataset,today)));
  const result=await backfillTaifex(db,{startDate:today,endDate:today,cacheDir:cache,fetchImpl:async()=>{throw Error('offline');}});
  assert.equal(result.state,'PARTIAL_SOURCE_FALLBACK');assert.equal(result.optionChangeRows,0);
  for(const table of ['raw_snapshots','futures_contract_daily','options_strike_daily','data_sources','official_backfill_files'])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0,table);
});

test('actual wrapper reports partial failure with nonzero status while running features and quality', () => {
  const wrapper=fileURLToPath(new URL('../scripts/backfill-taifex.mjs',import.meta.url));
  const harness=`import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
    const logs=[],calls=[],proc={env:{},exitCode:0};const context=vm.createContext({console:{log:v=>logs.push(v)},process:proc,Date});
    const mocks={
      'node:fs':{default:{mkdirSync(){},writeFileSync(){calls.push('report')}}},'node:path':{default:path},
      '../src/config.mjs':{v2Config:()=>({root:'/synthetic',databasePath:'/synthetic/db',migrationsPath:'/synthetic/migrations',reportsPath:'/synthetic/reports'})},
      '../src/db.mjs':{openDatabase:()=>({prepare:()=>({get:()=>({date:'2026-11-04'})}),close(){calls.push('close')}}),applyMigrations(){}},
      '../src/official-backfill.mjs':{backfillTaifex:async()=>({state:'PARTIAL_SOURCE_FALLBACK',failures:[{reason:'TAIFEX_FETCH_FAILED'}]})},
      '../src/features.mjs':{rebuildFeatures(){calls.push('features');return {rows:1}}},
      '../src/quality.mjs':{runQualityChecks(){calls.push('quality');return {coverage:{},issues:[],byRule:{}}}}
    };
    const module=new vm.SourceTextModule(fs.readFileSync(${JSON.stringify(wrapper)},'utf8'),{context});
    await module.link(spec=>{const values=mocks[spec];if(!values)throw Error('unexpected import');return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v)},{context})});
    await module.evaluate();console.log(JSON.stringify({logs,calls,exitCode:proc.exitCode}));`;
  const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',harness],{env:{},encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const receipt=JSON.parse(result.stdout.trim());assert.equal(receipt.exitCode,1);
  assert.deepEqual(receipt.calls,['features','quality','report','close']);
  assert.equal(JSON.parse(receipt.logs.at(-1)).ok,false);
  assert.ok(receipt.logs.some(line=>line.includes('Completed post-import rebuildFeatures')));
  assert.ok(receipt.logs.some(line=>line.includes('Completed post-import runQualityChecks')));
});
