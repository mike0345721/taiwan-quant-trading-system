import fs from'node:fs';import path from'node:path';import{applyMigrations,openDatabase}from'../src/db.mjs';import{v2Config}from'../src/config.mjs';
const config=v2Config();const db=openDatabase(config.databasePath);
const policies={
  calculated_option_volatility:{notBefore:'16:45:00',usable:'next_regular_session'},
  taifex_futures_institutional_dealer:{notBefore:'16:30:00',usable:'next_regular_session'},
  taifex_futures_institutional_investment_trust:{notBefore:'16:30:00',usable:'next_regular_session'},
  taifex_futures_market_oi:{notBefore:'16:30:00',usable:'next_regular_session'},
  taifex_option_institutional:{notBefore:'16:30:00',usable:'next_regular_session'},
  taifex_option_large_trader:{notBefore:'16:30:00',usable:'next_regular_session'},
  twse_market_breadth:{notBefore:'20:05:00',usable:'next_regular_session'},
  tpex_market_breadth:{notBefore:'20:05:00',usable:'next_regular_session'},
  twse_securities_lending:{notBefore:'23:35:00',usable:'next_regular_session'},
  twse_spot_institutional_final:{notBefore:'20:05:00',usable:'next_regular_session'},
};
const parse=(value)=>Number.isFinite(Date.parse(value))?new Date(value):null;
try{applyMigrations(db,config.migrationsPath);const failures=[];const summary=[];for(const[key,policy]of Object.entries(policies)){const rows=db.prepare(`SELECT * FROM research_input_registry_daily WHERE dataset_key=? AND collection_status='success' ORDER BY trade_date`).all(key);let valid=0;for(const row of rows){const available=parse(row.available_at);const retrieved=parse(row.retrieved_at);const time=String(row.available_at||'').match(/T(\d{2}:\d{2}:\d{2})/)?.[1];const issues=[];if(!available)issues.push('invalid_available_at');if(!retrieved)issues.push('invalid_retrieved_at');if(!String(row.available_at||'').endsWith('+08:00'))issues.push('available_at_not_taipei_offset');if(time&&time<policy.notBefore)issues.push(`published_before_policy_${policy.notBefore}`);if(row.available_at&&!row.available_at.startsWith(row.trade_date))issues.push('available_date_differs_from_trade_date');for(const field of['revision','session_scope','product_scope','unit','source_url'])if(!String(row[field]||'').trim())issues.push(`missing_${field}`);if(issues.length)failures.push({datasetKey:key,tradeDate:row.trade_date,issues});else valid+=1;}summary.push({datasetKey:key,successRows:rows.length,validRows:valid,invalidRows:rows.length-valid,notBeforeTaipei:policy.notBefore,usableFrom:policy.usable});}
 const report={generatedAt:new Date().toISOString(),passed:failures.length===0,decisionRule:'All audited datasets are post-close and may only be used from the next regular-session decision point.',summary,failureCount:failures.length,failures:failures.slice(0,500)};fs.writeFileSync(path.join(config.reportsPath,'v3-6-2-available-at-audit.json'),`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2));
}finally{db.close();}
