import { applyMigrations, openDatabase, withTransaction } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { parseTpexBreadth, parseTwseBreadth, payloadHash } from '../src/official-extended-parsers.mjs';

const config=v2Config(); const db=openDatabase(config.databasePath); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const compact=d=>d.replaceAll('-',''); const slash=d=>d.replaceAll('-','/');
async function json(url){let last;for(let attempt=0;attempt<5;attempt+=1){try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 tw-chip research','Accept':'application/json','Referer':new URL(url).origin+'/'} });if(!r.ok)throw new Error(`HTTP ${r.status}`);const data=await r.json();if(data?.stat && String(data.stat).toUpperCase()!=='OK')throw new Error(`source status ${data.stat}`);return data;}catch(e){last=e;await sleep(1500*(attempt+1));}}throw last;}
async function collect(market,date){const url=market==='TWSE'
  ?`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compact(date)}&type=ALL&response=json`
  :`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${slash(date)}&id=&response=json`;
  const retrievedAt=new Date().toISOString();try{const payload=await json(url);const parsed=market==='TWSE'?parseTwseBreadth(payload):parseTpexBreadth(payload);return{market,date,url,retrievedAt,ok:true,parsed,hash:payloadHash(payload)};}catch(e){return{market,date,url,retrievedAt,ok:false,error:String(e?.message||e)};}}
try{
  applyMigrations(db,config.migrationsPath);const bounds=db.prepare(`SELECT MIN(trade_date) first,MAX(trade_date) last FROM market_daily WHERE tx_close IS NOT NULL`).get();const start=process.env.V2_BREADTH_START||bounds.first;const end=process.env.V2_BREADTH_END||bounds.last;
  const calendar=db.prepare(`SELECT trade_date FROM market_daily WHERE trade_date BETWEEN ? AND ? AND tx_close IS NOT NULL ORDER BY trade_date`).all(start,end).map(r=>r.trade_date);
  const existing=new Set(db.prepare(`SELECT market||'|'||trade_date key FROM market_breadth_history_daily WHERE trade_date BETWEEN ? AND ? AND quality_status='official_complete'`).all(start,end).map(r=>r.key));
  const allJobs=[];for(const date of calendar)for(const market of ['TWSE','TPEX'])if(!existing.has(`${market}|${date}`))allJobs.push({market,date});
  const jobs=allJobs.slice(0,Number(process.env.V2_BREADTH_MAX_JOBS||200));
  const insert=db.prepare(`INSERT OR REPLACE INTO market_breadth_history_daily
    (trade_date,market,advance,decline,unchanged,limit_up,limit_down,universe_scope,derivation,available_at,retrieved_at,source_url,payload_sha256,quality_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'official_complete')`);
  const updateTwse=db.prepare(`UPDATE market_daily SET listed_advance=?,listed_decline=?,listed_limit_up=?,listed_limit_down=? WHERE trade_date=?`);
  const updateTpex=db.prepare(`UPDATE market_daily SET otc_advance=?,otc_decline=?,otc_limit_up=?,otc_limit_down=? WHERE trade_date=?`);
  const register=db.prepare(`INSERT OR REPLACE INTO research_input_registry_daily
    (dataset_key,trade_date,collection_status,available_at,retrieved_at,revision,session_scope,product_scope,expiry_scope,participant_scope,unit,source_url,payload_sha256,row_count,quality_status,rollover_flag,error)
    VALUES (?,?,?,?,?,'final_daily','regular',?,'','','securities',?,?,?, ?,0,?)`);
  const persist=(results)=>withTransaction(db,()=>{for(const r of results){const key=r.market==='TWSE'?'twse_market_breadth':'tpex_market_breadth';const scope=r.market==='TWSE'?'TWSE_COMMON_STOCKS':'TPEX_FOUR_DIGIT_COMMON_STOCKS';const available=`${r.date}T20:05:00+08:00`;if(!r.ok){register.run(key,r.date,'source_error',available,r.retrievedAt,scope,r.url,null,0,'source_error',r.error);continue;}const p=r.parsed;const derivation=r.market==='TWSE'?'official_market_summary_stock_column':p.derivation;insert.run(r.date,r.market,p.advance,p.decline,p.unchanged,p.limitUp,p.limitDown,p.universeScope,derivation,available,r.retrievedAt,r.url,r.hash);if(r.market==='TWSE')updateTwse.run(p.advance,p.decline,p.limitUp,p.limitDown,r.date);else updateTpex.run(p.advance,p.decline,p.limitUp,p.limitDown,r.date);register.run(key,r.date,'success',available,r.retrievedAt,scope,r.url,r.hash,1,r.market==='TWSE'?'official_final_complete':'official_quotes_derived_complete',null);}});
  const failures=[];let success=0;const workers=Number(process.env.V2_BREADTH_WORKERS||1);const batchSize=Number(process.env.V2_BREADTH_BATCH||20);for(let offset=0;offset<jobs.length;offset+=batchSize){const batch=jobs.slice(offset,offset+batchSize);const results=[];let cursor=0;await Promise.all(Array.from({length:Math.min(workers,batch.length)},async()=>{while(cursor<batch.length){const job=batch[cursor++];results.push(await collect(job.market,job.date));await sleep(Number(process.env.V2_BREADTH_DELAY_MS||1200));}}));persist(results);success+=results.filter(r=>r.ok).length;failures.push(...results.filter(r=>!r.ok));console.log(`breadth progress ${Math.min(offset+batch.length,jobs.length)}/${jobs.length}; success=${success}; failures=${failures.length}`);}
  db.exec(`UPDATE market_daily SET
    listed_advance=(SELECT advance FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TWSE'),
    listed_decline=(SELECT decline FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TWSE'),
    listed_limit_up=(SELECT limit_up FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TWSE'),
    listed_limit_down=(SELECT limit_down FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TWSE')
    WHERE EXISTS (SELECT 1 FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TWSE');
    UPDATE market_daily SET
    otc_advance=(SELECT advance FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TPEX'),
    otc_decline=(SELECT decline FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TPEX'),
    otc_limit_up=(SELECT limit_up FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TPEX'),
    otc_limit_down=(SELECT limit_down FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TPEX')
    WHERE EXISTS (SELECT 1 FROM market_breadth_history_daily b WHERE b.trade_date=market_daily.trade_date AND b.market='TPEX');`);
  const coverage=db.prepare(`SELECT market,COUNT(*) days,MIN(trade_date) first,MAX(trade_date) last FROM market_breadth_history_daily GROUP BY market`).all();console.log(JSON.stringify({start,end,calendarDays:calendar.length,remainingBeforeRun:allJobs.length,requestedJobs:jobs.length,success,failureCount:failures.length,failureSample:failures.slice(0,20),coverage},null,2));
}finally{db.close();}
